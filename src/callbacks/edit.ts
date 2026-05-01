/**
 * Callback handlers for the /edit flow.
 *
 *   editpick:<id>          → show member detail card + field-picker keyboard
 *   editfield:<field>:<id> → edit message to "Editing…", enter editField conversation
 *   editdone:<id>          → remove buttons, reply "✅ Done editing [name]."
 *
 * Shared helpers (buildDetailCard, buildFieldKeyboard) are exported so the
 * editField conversation can re-render the detail card after saving.
 */

import { InlineKeyboard, type CallbackQueryContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { getMember } from "../db/members";
import type { MemberRow } from "../db/members";
import { esc } from "../utils/format";
import { formatDate } from "../utils/dates";
import { ownerKeyboard } from "../utils/keyboards";

// ── Shared helpers (also used by editField conversation) ──────────────────────

export function buildDetailCard(m: MemberRow): string {
  return (
    `✏️ Editing <b>${esc(m.name)}</b> (ID #${m.id})\n\n` +
    `Current details:\n` +
    `👤 Name: ${esc(m.name)}\n` +
    `📞 Phone: ${m.phone ? esc(m.phone) : "—"}\n` +
    `💰 Amount paid: ₹${m.amount_paid}\n` +
    `🗓 Admission: ${formatDate(m.admission_date)}\n` +
    `⏰ Expires: ${formatDate(m.expiry_date)}`
  );
}

export function buildFieldKeyboard(memberId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ Edit name",   `editfield:name:${memberId}`).row()
    .text("✏️ Edit phone",  `editfield:phone:${memberId}`).row()
    .text("✏️ Edit amount", `editfield:amount:${memberId}`).row()
    .text("✏️ Edit expiry", `editfield:expiry:${memberId}`).row()
    .text("❌ Done",        `editdone:${memberId}`);
}

// ── editpick:<id> ─────────────────────────────────────────────────────────────

export async function editPickCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    const memberId = parseInt(ctx.callbackQuery.data.split(":")[1], 10);
    if (!memberId) return;

    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.editMessageText("Session expired. Send /edit again.");
      return;
    }

    const member = await getMember(ctx.env.DB, memberId, gym.id);
    if (!member || member.status !== "active") {
      await ctx.editMessageText(
        "This member is no longer active. Send /edit to see the current list."
      );
      return;
    }

    await ctx.editMessageText(buildDetailCard(member), {
      parse_mode: "HTML",
      reply_markup: buildFieldKeyboard(memberId),
    });
  } catch (err) {
    console.error("[editPickCallback]", err);
    await ctx.editMessageText("Something went wrong. Please try again.");
  }
}

// ── editfield:<field>:<id> ────────────────────────────────────────────────────

export async function editFieldCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    const parts    = ctx.callbackQuery.data.split(":");
    const field    = parts[1];  // "name" | "phone" | "amount" | "expiry"
    const memberId = parseInt(parts[2], 10);
    if (!field || !memberId) return;

    // Guard: don't stack conversations
    if (ctx.conversation.active("editField") > 0) {
      await ctx.answerCallbackQuery(
        "Finish the current edit first, or send /cancel."
      );
      return;
    }

    const fieldLabel: Record<string, string> = {
      name:   "name",
      phone:  "phone",
      amount: "amount paid",
      expiry: "expiry date",
    };

    // Collapse the detail card into a brief status line so the keyboard
    // disappears and the user can't tap multiple field buttons at once.
    await ctx.editMessageText(
      `✏️ <i>Editing ${fieldLabel[field] ?? field}…</i>`,
      { parse_mode: "HTML" }
    );

    await ctx.conversation.enter("editField", field, memberId);
  } catch (err) {
    console.error("[editFieldCallback]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}

// ── editdone:<id> ─────────────────────────────────────────────────────────────

export async function editDoneCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    const memberId = parseInt(ctx.callbackQuery.data.split(":")[1], 10);
    if (!memberId) return;

    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);

    let memberName = "member";
    if (gym) {
      const member = await getMember(ctx.env.DB, memberId, gym.id);
      if (member) memberName = member.name;
    }

    // Remove the inline keyboard from the detail card
    await ctx.editMessageText(`✏️ <i>Editing complete.</i>`, {
      parse_mode: "HTML",
    });
    await ctx.reply(
      `✅ Done editing <b>${esc(memberName)}</b>.`,
      { parse_mode: "HTML", reply_markup: ownerKeyboard() }
    );
  } catch (err) {
    console.error("[editDoneCallback]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
