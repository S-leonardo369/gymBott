import { Keyboard } from "grammy";

// ── Page 1 — main menu ────────────────────────────────────────────────────────

/**
 * Page 1 of the owner reply keyboard (main menu).
 *
 *   ➕ Add member  |  📋 List members
 *   ⚠️ Expiring   |  ❌ Cancel member
 *   ❓ Help        |  ➡️ More
 */
export function ownerKeyboardPage1(): Keyboard {
  return new Keyboard()
    .text("➕ Add member").text("📋 List members").row()
    .text("⚠️ Expiring").text("❌ Cancel member").row()
    .text("❓ Help").text("➡️ More")
    .resized()
    .persistent();
}

// Alias kept for backward-compatibility — all existing callers work unchanged
export const ownerKeyboard = ownerKeyboardPage1;

// ── Page 2 — more commands ────────────────────────────────────────────────────

/**
 * Page 2 of the owner reply keyboard (extra commands).
 *
 *   ✏️ Edit    |  📊 Stats
 *   📥 Export  |  💬 Feedback
 *   ⬅️ Back    |  ❓ Help
 */
export function ownerKeyboardPage2(): Keyboard {
  return new Keyboard()
    .text("✏️ Edit").text("📊 Stats").row()
    .text("📥 Export").text("💬 Feedback").row()
    .text("⬅️ Back").text("❓ Help")
    .resized()
    .persistent();
}

// ── All reply-keyboard labels ─────────────────────────────────────────────────

/**
 * Every possible reply-keyboard button label across both pages.
 * Used inside conversations to detect when the user presses a keyboard
 * button instead of typing a real answer, so the conversation can warn
 * and re-wait rather than treating the label as a field value.
 *
 * Unique labels (❓ Help appears on both pages but is listed once):
 *   Page 1: ➕ Add member, 📋 List members, ⚠️ Expiring, ❌ Cancel member,
 *           ❓ Help, ➡️ More
 *   Page 2: ✏️ Edit, 📊 Stats, 📥 Export, 💬 Feedback, ⬅️ Back
 *   (❓ Help shared — 11 unique labels total)
 */
export const REPLY_KEYBOARD_TEXTS: readonly string[] = [
  // Page 1
  "➕ Add member",
  "📋 List members",
  "⚠️ Expiring",
  "❌ Cancel member",
  "❓ Help",
  "➡️ More",
  // Page 2 (unique)
  "✏️ Edit",
  "📊 Stats",
  "📥 Export",
  "💬 Feedback",
  "⬅️ Back",
] as const;
