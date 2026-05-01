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
 * All reply-keyboard button labels — used inside conversations to detect
 * when the user presses a keyboard button instead of typing a real answer,
 * so the conversation can warn and re-wait rather than treating the label
 * as a field value.
 */
export const REPLY_KEYBOARD_TEXTS: readonly string[] = [
  "➕ Add member",
  "📋 List members",
  "⚠️ Expiring",
  "❌ Cancel member",
  "❓ Help",
] as const;
