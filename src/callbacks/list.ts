import type { CallbackQueryContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import {
  listActiveMembers,
  countActiveMembers,
  listExpiringMembers,
  countExpiringMembers,
} from "../db/members";
import { renderMemberList, PAGE_SIZE } from "../utils/format";

// ── /list pagination ──────────────────────────────────────────────────────────

export async function listPageCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    const page = parseInt(ctx.callbackQuery.data.split(":")[1], 10);
    if (!page || page < 1) return;

    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.editMessageText("Session expired. Send /list again.");
      return;
    }

    const total   = await countActiveMembers(ctx.env.DB, gym.id);
    const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, maxPage);
    const offset   = (safePage - 1) * PAGE_SIZE;
    const members  = await listActiveMembers(ctx.env.DB, gym.id, PAGE_SIZE, offset);

    const { text, keyboard } = renderMemberList("active", members, total, safePage);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
  } catch (err) {
    console.error("[list callback]", err);
    await ctx.editMessageText("Something went wrong. Please try again.");
  }
}

// ── /expiring pagination ──────────────────────────────────────────────────────

const EXPIRING_DAYS = 7;

export async function expiringPageCallback(
  ctx: CallbackQueryContext<BotContext>
): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    const page = parseInt(ctx.callbackQuery.data.split(":")[1], 10);
    if (!page || page < 1) return;

    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.editMessageText("Session expired. Send /expiring again.");
      return;
    }

    const total    = await countExpiringMembers(ctx.env.DB, gym.id, EXPIRING_DAYS);
    const maxPage  = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(page, maxPage);
    const offset   = (safePage - 1) * PAGE_SIZE;
    const members  = await listExpiringMembers(ctx.env.DB, gym.id, EXPIRING_DAYS, PAGE_SIZE, offset);

    const { text, keyboard } = renderMemberList("expiring", members, total, safePage);
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
  } catch (err) {
    console.error("[expiring callback]", err);
    await ctx.editMessageText("Something went wrong. Please try again.");
  }
}
