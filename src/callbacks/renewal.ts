/**
 * Callback handlers for the three inline buttons on cron notification messages:
 *
 *   renew:<id>              → enter renewMember conversation
 *   notyet:<id>             → acknowledge, edit message, no DB change
 *   cancelmember:<id>       → show confirm/back prompt
 *   cancelmemberconfirm:<id>→ cancel the member (status = 'cancelled')
 *   cancelmemberback        → dismiss prompt, no DB change
 *
 * All handlers re-query gym by ctx.from.id + member with gym_id in WHERE so
 * cross-gym access is impossible even if callback_data is tampered.
 */

import { InlineKeyboard, type CallbackQueryContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { getMember } from "../db/members";
import { esc } from "../utils/format";
import { formatDate } from "../utils/dates";

// ── Helper: extract numeric ID from "prefix:123" ─────────────────────────────

function parseId(data: string): number {
  return parseInt(data.split(":")[1] ?? "0", 10);
}

// ── renew:<id> ────────────────────────────────────────────────────────────────

/**
 * Verifies the member is real + belongs to this gym, then enters the
 * renewMember conversation passing the memberId as an extra arg.
 */
export async function renewCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    const memberId = parseId(ctx.callbackQuery.data);
    if (!memberId) return;

    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.reply("Session expired. Please send /start.");
      return;
    }

    const member = await getMember(ctx.env.DB, memberId, gym.id);
    if (!member) {
      await ctx.reply("Member not found.");
      return;
    }
    if (member.status === "terminated" || member.status === "cancelled") {
      await ctx.reply(
        `⚠️ <b>${esc(member.name)}</b> is already <b>${member.status}</b>. ` +
        `Use /add to create a new membership.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Enter the multi-step renewal conversation; memberId is passed as extra arg
    await ctx.conversation.enter("renewMember", memberId);
  } catch (err) {
    console.error("[renewCallback]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}

// ── notyet:<id> ───────────────────────────────────────────────────────────────

/**
 * Owner tapped "Not yet" — just edit the notification message to acknowledge.
 * No DB change. The cron will re-evaluate the next day, and the 20-hour dedup
 * will have expired by then so a fresh notification goes out.
 */
export async function notyetCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery("Got it — will remind again tomorrow.");
  try {
    await ctx.editMessageText("⏳ <b>Noted — will remind tomorrow.</b>", {
      parse_mode: "HTML",
    });
  } catch {
    // Message may be too old to edit (>48 h); silently ignore
  }
}

// ── cancelmember:<id> ─────────────────────────────────────────────────────────

/**
 * Shows a confirmation step before cancelling the member.
 * Two options: "✅ Yes, cancel" or "❌ Back".
 */
export async function cancelMemberCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    const memberId = parseId(ctx.callbackQuery.data);
    if (!memberId) return;

    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.editMessageText("Session expired. Please send /start.");
      return;
    }

    const member = await getMember(ctx.env.DB, memberId, gym.id);
    if (!member) {
      await ctx.editMessageText("Member not found.");
      return;
    }
    if (member.status !== "active" && member.status !== "expired") {
      await ctx.editMessageText(
        `<b>${esc(member.name)}</b> is already <b>${member.status}</b> — nothing to cancel.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const keyboard = new InlineKeyboard()
      .text("✅ Yes, cancel", `cancelmemberconfirm:${memberId}`)
      .row()
      .text("❌ Back",        "cancelmemberback");

    await ctx.editMessageText(
      `⚠️ Cancel <b>${esc(member.name)}</b>'s membership?\n\n` +
      `Expiry: ${formatDate(member.expiry_date)}\n` +
      `Their record will be kept for history.`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch (err) {
    console.error("[cancelMemberCallback]", err);
    await ctx.editMessageText("Something went wrong. Please try again.");
  }
}

// ── cancelmemberconfirm:<id> ──────────────────────────────────────────────────

export async function cancelMemberConfirmCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    const memberId = parseId(ctx.callbackQuery.data);
    if (!memberId) return;

    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.editMessageText("Session expired. Please send /start.");
      return;
    }

    // Re-fetch to get current status (required before mutating)
    const member = await getMember(ctx.env.DB, memberId, gym.id);
    if (!member) {
      await ctx.editMessageText("Member not found — no changes made.");
      return;
    }
    if (member.status === "cancelled" || member.status === "terminated") {
      await ctx.editMessageText(
        `Already <b>${member.status}</b> — no changes made.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const oldStatus = member.status;

    // UPDATE — guard with gym_id and status IN ('active','expired')
    const result = await ctx.env.DB
      .prepare(
        `UPDATE members
         SET status = 'cancelled'
         WHERE id = ? AND gym_id = ? AND status IN ('active', 'expired')`
      )
      .bind(memberId, gym.id)
      .run();

    if ((result.meta.changes ?? 0) > 0) {
      console.log(`[STATE] member ${memberId}: ${oldStatus} -> cancelled`);
      await ctx.editMessageText(
        `✅ <b>${esc(member.name)}</b> cancelled.`,
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.editMessageText(
        "Could not cancel — member may already be inactive."
      );
    }
  } catch (err) {
    console.error("[cancelMemberConfirmCallback]", err);
    await ctx.editMessageText("Something went wrong. Please try again.");
  }
}

// ── cancelmemberback ──────────────────────────────────────────────────────────

export async function cancelMemberBackCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    await ctx.editMessageText("↩️ Cancelled — no changes made.");
  } catch {
    // Ignore edit errors (message too old, etc.)
  }
}
