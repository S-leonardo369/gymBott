import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { getGymStats } from "../db/stats";
import { esc } from "../utils/format";
import { ownerKeyboard } from "../utils/keyboards";

export async function statsCommand(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const userId = String(ctx.from?.id);
    if (!userId || userId === "undefined") return;

    const gym = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.reply("Please send /start first to register your gym.");
      return;
    }

    const s = await getGymStats(ctx.env.DB, gym.id);

    await ctx.reply(
      `📊 <b>${esc(gym.gym_name)}</b> — Stats\n\n` +
        `📌 Active members: <b>${s.activeCount}</b>\n` +
        `➕ New this month: <b>${s.newThisMonth}</b>\n` +
        `❌ Total cancelled (all-time): <b>${s.totalCancelled}</b>\n` +
        `⏹ Auto-terminated this month: <b>${s.terminatedThisMonth}</b>\n\n` +
        `💰 Revenue this month: <b>₹${s.revenueThisMonth.toLocaleString()}</b>\n` +
        `💰 Revenue last month: <b>₹${s.revenueLastMonth.toLocaleString()}</b>\n\n` +
        `⚠️ Expiring in next 7 days: <b>${s.expiringIn7Days}</b>`,
      { parse_mode: "HTML", reply_markup: ownerKeyboard() }
    );
  } catch (err) {
    console.error("[/stats]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
