import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { listExpiringMembers, countExpiringMembers } from "../db/members";
import { renderMemberList, PAGE_SIZE } from "../utils/format";

const EXPIRING_DAYS = 7;

export async function expiringCommand(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.reply("Please send /start first to register your gym.");
      return;
    }

    const total   = await countExpiringMembers(ctx.env.DB, gym.id, EXPIRING_DAYS);
    const members = await listExpiringMembers(ctx.env.DB, gym.id, EXPIRING_DAYS, PAGE_SIZE, 0);
    const { text, keyboard } = renderMemberList("expiring", members, total, 1);

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error("[/expiring]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
