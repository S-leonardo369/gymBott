import { InlineKeyboard, type CallbackQueryContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { getMember, cancelMember } from "../db/members";
import { esc } from "../utils/format";
import { formatDate } from "../utils/dates";

// ── Step 2: member picked — show confirm / back ───────────────────────────────

export async function cancelPickCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    const memberId = parseInt(ctx.callbackQuery.data.split(":")[1], 10);
    if (!memberId) return;

    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.editMessageText("Session expired. Send /cancel again.");
      return;
    }

    // Re-fetch member with gym_id scoping — prevents cross-gym access
    const member = await getMember(ctx.env.DB, memberId, gym.id);
    if (!member || member.status !== "active") {
      await ctx.editMessageText(
        "This member is no longer active. Send /cancel to see the current list."
      );
      return;
    }

    const keyboard = new InlineKeyboard()
      .text("✅ Confirm cancel", `cancelconfirm:${memberId}`)
      .row()
      .text("❌ Back", "cancelback");

    await ctx.editMessageText(
      `⚠️ Cancel <b>${esc(member.name)}</b>'s membership?\n\n` +
        `Expires: ${formatDate(member.expiry_date)}\n` +
        `Their record will be kept for history.`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  } catch (err) {
    console.error("[cancelPick]", err);
    await ctx.editMessageText("Something went wrong. Please try again.");
  }
}

// ── Step 3a: confirmed ────────────────────────────────────────────────────────

export async function cancelConfirmCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    const memberId = parseInt(ctx.callbackQuery.data.split(":")[1], 10);
    if (!memberId) return;

    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.editMessageText("Session expired. Send /cancel again.");
      return;
    }

    // Re-fetch for name display + ensure still active
    const member = await getMember(ctx.env.DB, memberId, gym.id);
    if (!member || member.status !== "active") {
      await ctx.editMessageText(
        "This member is no longer active — no changes made."
      );
      return;
    }

    // gym_id is enforced inside cancelMember's WHERE clause
    const changed = await cancelMember(ctx.env.DB, memberId, gym.id);
    if (changed) {
      console.log(`[STATE] member ${memberId}: active -> cancelled`);
      await ctx.editMessageText(`✅ <b>${esc(member.name)}</b> cancelled.`, {
        parse_mode: "HTML",
      });
    } else {
      await ctx.editMessageText(
        "Could not cancel — member may already be inactive."
      );
    }
  } catch (err) {
    console.error("[cancelConfirm]", err);
    await ctx.editMessageText("Something went wrong. Please try again.");
  }
}

// ── Step 3b: went back ────────────────────────────────────────────────────────

export async function cancelBackCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    await ctx.editMessageText("Cancelled — no changes.");
  } catch (err) {
    console.error("[cancelBack]", err);
  }
}
