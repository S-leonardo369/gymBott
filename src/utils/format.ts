import { InlineKeyboard } from "grammy";
import { today, formatDate, daysBetween } from "./dates";

// ── HTML safety ───────────────────────────────────────────────────────────────

/** Escapes characters that have special meaning in Telegram HTML parse mode. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Member list rendering ─────────────────────────────────────────────────────

export interface MemberListItem {
  id: number;
  name: string;
  expiry_date: string;
}

export const PAGE_SIZE = 10;

export interface RenderedList {
  text: string;
  keyboard: InlineKeyboard;
}

function memberLine(idx: number, m: MemberListItem, todayStr: string): string {
  const days = daysBetween(todayStr, m.expiry_date);
  const emoji = days < 0 ? "🔴" : days <= 7 ? "⚠️" : "📅";
  // Show negative days as-is so the owner knows how far past expiry
  const dayLabel = Math.abs(days) === 1 ? "1 day" : `${Math.abs(days)} days`;
  const suffix = days < 0 ? `${dayLabel} overdue` : `in ${dayLabel}`;
  return `${idx}. ${emoji} ${esc(m.name)} — expires ${formatDate(m.expiry_date)} (${suffix})`;
}

/**
 * Builds the text + pagination keyboard for /list and /expiring.
 * Handles empty state, header, member lines, and prev/next buttons.
 */
export function renderMemberList(
  mode: "active" | "expiring",
  members: MemberListItem[],
  total: number,
  page: number
): RenderedList {
  if (total === 0) {
    const text =
      mode === "active"
        ? "No active members yet. Use /add to add one."
        : "No members expiring in the next 7 days. 👍";
    return { text, keyboard: new InlineKeyboard() };
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const todayStr   = today();
  const offset     = (page - 1) * PAGE_SIZE;

  const header =
    mode === "active"
      ? `📋 <b>Active members (${total})</b> — page ${page} of ${totalPages}`
      : `⚠️ <b>Expiring soon (${total})</b> — page ${page} of ${totalPages}`;

  const lines = members.map((m, i) => memberLine(offset + i + 1, m, todayStr));
  const text  = header + "\n\n" + lines.join("\n");

  const prefix   = mode === "active" ? "list" : "expiring";
  const keyboard = new InlineKeyboard();
  if (page > 1)          keyboard.text("⬅ Prev", `${prefix}:${page - 1}`);
  if (page < totalPages) keyboard.text("Next ➡",  `${prefix}:${page + 1}`);

  return { text, keyboard };
}
