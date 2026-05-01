import { Keyboard } from "grammy";

/**
 * Persistent reply keyboard shown to registered gym owners.
 * Buttons send their label as plain text — matched by bot.hears() in index.ts.
 */
export function ownerKeyboard(): Keyboard {
  return new Keyboard()
    .text("➕ Add member").text("📋 List members").row()
    .text("⚠️ Expiring").text("❌ Cancel member").row()
    .text("❓ Help")
    .resized()
    .persistent();
}

/**
 * Persistent reply keyboard shown to guests who haven't registered yet.
 */
export function guestKeyboard(): Keyboard {
  return new Keyboard()
    .text("🚀 Start").text("❓ Help")
    .resized()
    .persistent();
}

/**
 * All reply-keyboard button labels — used inside conversations to detect
 * when the user presses a keyboard button instead of typing a real answer,
 * so the conversation can call conversation.skip() and let the bot-level
 * handler process it normally.
 */
export const REPLY_KEYBOARD_TEXTS: readonly string[] = [
  "➕ Add member",
  "📋 List members",
  "⚠️ Expiring",
  "❌ Cancel member",
  "❓ Help",
  "🚀 Start",
] as const;
