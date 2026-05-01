import type { Context } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../index";
import type { Gym } from "../db/gyms";
import { esc } from "../utils/format";
import { ownerKeyboard, REPLY_KEYBOARD_TEXTS } from "../utils/keyboards";

type Conv = Conversation<BotContext, Context>;

// ── Sentinel thrown when the user cancels from inside ask() ──────────────────
class ConversationCancelled extends Error {}

// ── Validator ─────────────────────────────────────────────────────────────────

function validateMessage(text: string): string | null {
  if (text.trim().length < 5)
    return "Please write at least 5 characters.";
  if (text.length > 2000)
    return "Message too long — please keep it under 2000 characters.";
  return null;
}

// ── ask() helper ──────────────────────────────────────────────────────────────

async function ask(
  conversation: Conv,
  ctx: Context,
  prompt: string
): Promise<string> {
  await ctx.reply(prompt, { parse_mode: "HTML" });

  while (true) {
    const inc = await conversation.waitFor("message:text");
    const text = inc.message.text.trim();

    if (text === "/cancel" || text === "❌ Cancel member") {
      await ctx.reply("❌ Feedback cancelled.", { reply_markup: ownerKeyboard() });
      throw new ConversationCancelled();
    }

    if (text.startsWith("/") || REPLY_KEYBOARD_TEXTS.includes(text)) {
      await ctx.reply(
        "⚠️ You're in the middle of sending feedback.\nSend /cancel to exit, or finish typing your message.",
        { reply_markup: ownerKeyboard() }
      );
      continue;
    }

    const err = validateMessage(text);
    if (err === null) return text;
    await inc.reply(err);
  }
}

// ── Telegram Bot API helper ───────────────────────────────────────────────────

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

// ── Format the message sent to the developer ─────────────────────────────────

function formatFeedback(gym: Gym, message: string): string {
  return (
    `📨 <b>Feedback from ${esc(gym.gym_name)}</b>\n\n` +
    `👤 Owner: ${esc(gym.owner_name)}\n` +
    `📞 Phone: ${esc(gym.owner_phone)}\n` +
    `🆔 Gym ID: ${gym.id}\n\n` +
    `${esc(message)}\n\n` +
    `<i>To reply, send /admin_reply ${gym.id} &lt;message&gt;</i>`
  );
}

// ── Conversation body ─────────────────────────────────────────────────────────

async function _feedbackConversationBody(
  conversation: Conv,
  ctx: Context
): Promise<void> {
  const userId = String(ctx.from?.id);

  // Fetch gym and env secrets via outerCtx so we get the real BotContext
  const gymAndEnv = await conversation.external((outerCtx) =>
    outerCtx.env.DB
      .prepare("SELECT * FROM gyms WHERE telegram_user_id = ? LIMIT 1")
      .bind(userId)
      .first<Gym>()
      .then((gym) => ({
        gym,
        botToken: outerCtx.env.BOT_TOKEN,
        devId:    outerCtx.env.DEVELOPER_TELEGRAM_ID ?? "",
      }))
  );

  const { gym, botToken, devId } = gymAndEnv;

  if (!gym) {
    await ctx.reply("Please send /start first to register your gym.");
    return;
  }

  const message = await ask(
    conversation,
    ctx,
    "💬 What's on your mind? (Send /cancel to exit)"
  );

  // Forward to developer
  if (devId) {
    await conversation.external(() =>
      sendTelegramMessage(botToken, devId, formatFeedback(gym, message))
    );
  } else {
    console.warn("[/feedback] DEVELOPER_TELEGRAM_ID not set — feedback dropped.");
  }

  await ctx.reply("✅ Sent to developer.", { reply_markup: ownerKeyboard() });
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function feedbackConversation(
  conversation: Conv,
  ctx: Context
): Promise<void> {
  try {
    await _feedbackConversationBody(conversation, ctx);
  } catch (e) {
    if (e instanceof ConversationCancelled) return;
    throw e;
  }
}
