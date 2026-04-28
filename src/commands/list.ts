import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { listActiveMembers, countActiveMembers } from "../db/members";
import { renderMemberList, PAGE_SIZE } from "../utils/format";

export async function listCommand(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.reply("Please send /start first to register your gym.");
      return;
    }

    const total   = await countActiveMembers(ctx.env.DB, gym.id);
    const members = await listActiveMembers(ctx.env.DB, gym.id, PAGE_SIZE, 0);
    const { text, keyboard } = renderMemberList("active", members, total, 1);

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error("[/list]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
