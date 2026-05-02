import { InlineKeyboard, type Context } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../index";
import { createGym } from "../db/gyms";
import { ownerKeyboard, REPLY_KEYBOARD_TEXTS } from "../utils/keyboards";
import { today, addDays } from "../utils/dates";

// ── Types ─────────────────────────────────────────────────────────────────────

type Conv = Conversation<BotContext, Context>;

// ── Sentinel thrown when the user cancels registration from inside ask() ──────
// Caught in onboardingConversation() so it can return normally and clear D1 state.
class ConversationCancelled extends Error {}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Validators ────────────────────────────────────────────────────────────────

function validateName(text: string): string | null {
  if (text.length < 2) return "Too short — must be at least 2 characters.";
  if (text.length > 60) return "Too long — must be 60 characters or fewer.";
  return null;
}

function validatePhone(text: string): string | null {
  if (!/^\d{10}$/.test(text))
    return "Must be exactly 10 digits with no spaces, dashes, or country code.";
  return null;
}

function validatePrice(text: string): string | null {
  const n = Number(text.trim());
  if (!Number.isInteger(n) || String(n) !== text.trim())
    return "Must be a whole number (e.g. 500).";
  if (n < 100) return "Must be at least ₹100.";
  if (n > 50_000) return "Must be ₹50,000 or less.";
  return null;
}

function validateGrace(text: string): string | null {
  if (text.toLowerCase() === "default") return null;
  const n = Number(text.trim());
  if (!Number.isInteger(n) || String(n) !== text.trim())
    return "Must be a whole number between 1 and 15, or the word 'default'.";
  if (n < 1) return "Must be at least 1 day.";
  if (n > 15) return "Must be 15 days or fewer.";
  return null;
}

// ── Helper: ask one question, re-ask on validation failure ───────────────────

/**
 * Sends `prompt`, then loops until the user sends a message that passes
 * `validator`. Returns the validated text.
 *
 * Cancel handling:
 *   /cancel → replies "❌ Registration cancelled. Send /start to try again."
 *             (no keyboard) and throws ConversationCancelled
 *   Other /commands or keyboard buttons → warns user to finish or /cancel,
 *             re-waits (no exit)
 */
async function ask(
  conversation: Conv,
  ctx: Context,
  prompt: string,
  validator: (text: string) => string | null
): Promise<string> {
  await ctx.reply(prompt, { parse_mode: "HTML" });

  while (true) {
    const incoming = await conversation.waitFor("message:text");
    const text = incoming.message.text.trim();

    // Hard cancel — exit registration cleanly; user types /start to retry
    if (text === "/cancel") {
      await ctx.reply("❌ Registration cancelled. Send /start to try again.");
      throw new ConversationCancelled();
    }

    // Other command or keyboard button while in registration — warn and re-wait
    if (text.startsWith("/") || REPLY_KEYBOARD_TEXTS.includes(text)) {
      await ctx.reply(
        "⚠️ You're in the middle of registration.\n" +
          "Send /cancel to start over, or continue answering the questions."
      );
      continue;
    }

    const err = validator(text);
    if (err === null) return text;
    await incoming.reply(
      `❌ ${esc(err)}\n\n${prompt}`,
      { parse_mode: "HTML" }
    );
  }
}

// ── Main conversation ─────────────────────────────────────────────────────────

export async function onboardingConversation(
  conversation: Conv,
  ctx: Context
): Promise<void> {
  try {
    await _onboardingConversationBody(conversation, ctx);
  } catch (e) {
    if (e instanceof ConversationCancelled) return;
    throw e;
  }
}

async function _onboardingConversationBody(
  conversation: Conv,
  ctx: Context
): Promise<void> {
  const userId = String(ctx.from?.id ?? "");

  // Wrap the entire flow in a loop so "Start over" works cleanly.
  while (true) {
    // Q1 — gym name
    const gymName = await ask(
      conversation,
      ctx,
      "👋 Welcome! Let's get you set up.\n\nWhat is your <b>gym's name</b>?",
      validateName
    );

    // Q2 — owner name
    const ownerName = await ask(
      conversation,
      ctx,
      "What is <b>your name</b> (owner / manager)?",
      validateName
    );

    // Q3 — phone
    const phone = await ask(
      conversation,
      ctx,
      "What is your <b>phone number</b>? (10 digits, no spaces or country code)",
      validatePhone
    );

    // Q4 — default plan price
    const priceText = await ask(
      conversation,
      ctx,
      "What is your <b>default monthly plan price</b> in ₹?\n<i>You can override this per member when adding them.</i>",
      validatePrice
    );
    const price = parseInt(priceText, 10);

    // Q5 — grace period
    const graceText = await ask(
      conversation,
      ctx,
      "How many <b>grace period days</b> should a member get after expiry before being auto-terminated?\n" +
        "<i>Recommended: 4. Send a number (1–15) or send 'default' for 4.</i>",
      validateGrace
    );
    const grace =
      graceText.toLowerCase() === "default" ? 4 : parseInt(graceText, 10);

    // Summary + confirm
    const summary =
      `📋 <b>Please confirm your details:</b>\n\n` +
      `🏋️ Gym: ${esc(gymName)}\n` +
      `👤 Owner: ${esc(ownerName)}\n` +
      `📞 Phone: ${esc(phone)}\n` +
      `💰 Default price: ₹${price}/month\n` +
      `⏳ Grace period: ${grace} day${grace !== 1 ? "s" : ""}`;

    const keyboard = new InlineKeyboard()
      .text("✅ Save", "onboard_save")
      .text("🔄 Start over", "onboard_restart");

    await ctx.reply(summary, { parse_mode: "HTML", reply_markup: keyboard });

    const btn = await conversation.waitForCallbackQuery([
      "onboard_save",
      "onboard_restart",
    ]);
    await btn.answerCallbackQuery();

    if (btn.callbackQuery.data === "onboard_restart") {
      await btn.editMessageText("🔄 Starting over…");
      continue;
    }

    // ── Save to DB (wrapped in external so it runs exactly once, never replayed) ──
    await conversation.external((outerCtx) =>
      createGym(outerCtx.env.DB, {
        telegram_user_id:   userId,
        gym_name:           gymName,
        owner_name:         ownerName,
        owner_phone:        phone,
        default_plan_price: price,
        grace_period_days:  grace,
        trial_ends_on:      addDays(today(), 30), // 1-month free trial
      })
    );

    await btn.editMessageText("✅ Registration complete!");
    await ctx.reply(
      `🎉 Welcome, <b>${esc(ownerName)}</b> from <b>${esc(gymName)}</b>!\n\n` +
        `Use the buttons below to get started, or /help anytime.`,
      { parse_mode: "HTML", reply_markup: ownerKeyboard() }
    );

    break;
  }
}
