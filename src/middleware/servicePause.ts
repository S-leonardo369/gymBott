/**
 * Service-pause middleware.
 *
 * When a gym owner's account is paused (is_active = 0), most bot commands
 * are blocked with a payment reminder.  Three commands remain functional:
 *   /paid      — owner notifies developer of payment
 *   /feedback  — contact developer directly
 *   /help      — show command list
 *
 * This middleware runs after env injection and after the conversations
 * plugin, so it does NOT interrupt an already-active conversation.
 * Callback queries are also passed through so existing inline buttons keep
 * working (the renewal/cancel buttons sent by the daily cron, etc.).
 */

import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { ownerKeyboard, REPLY_KEYBOARD_TEXTS } from "../utils/keyboards";

const ALLOWED_WHEN_PAUSED = new Set(["/paid", "/feedback", "/help"]);

// Navigation buttons switch keyboard pages — always allowed so a paused owner
// can still reach page 2 to find the 💬 Feedback button.
const NAVIGATION_BUTTONS = new Set(["➡️ More", "⬅️ Back"]);

export async function servicePauseMiddleware(
  ctx: BotContext,
  next: () => Promise<void>
): Promise<void> {
  // Only applies to text messages (commands + keyboard buttons + free text)
  const text = ctx.message?.text;
  if (!text) return next();

  const userId = String(ctx.from?.id);
  if (!userId || userId === "undefined") return next();

  // Only intercept if the text looks like a command or a reply-keyboard button.
  // Free-text messages fall through to the existing fallback handler.
  const isCommand   = text.startsWith("/");
  const isKbButton  = REPLY_KEYBOARD_TEXTS.includes(text);
  if (!isCommand && !isKbButton) return next();

  // Fetch the gym — if DB fails, let the request through (fail open)
  let gym;
  try {
    gym = await getGymByTelegramId(ctx.env.DB, userId);
  } catch {
    return next();
  }

  // No gym or gym is active → pass through
  if (!gym || gym.is_active !== 0) return next();

  // Navigation buttons (➡️ More / ⬅️ Back) always pass through — they only
  // switch keyboard pages and let the owner reach /feedback even when paused.
  if (isKbButton && NAVIGATION_BUTTONS.has(text)) return next();

  // Gym is paused — check if this specific command is allowed
  if (isCommand) {
    // Strip bot-username suffix (/paid@MyBot → /paid) and any args
    const baseCmd = text.split("@")[0].split(" ")[0];
    if (ALLOWED_WHEN_PAUSED.has(baseCmd)) return next();
  }

  // Blocked — send the paused notice and consume the update
  await ctx.reply(
    "🛑 Service paused. Please pay your bill to reactivate.\n" +
      "Send /paid once you've sent the payment.",
    { reply_markup: ownerKeyboard() }
  );
}
