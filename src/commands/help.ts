import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";

const HELP_REGISTERED = `
<b>GymBot Commands</b>

/add — Add a new member
/list — View all active members
/expiring — Members expiring in the next 7 days
/cancel — Cancel a member's membership
/stats — Your gym statistics
/help — Show this message
`.trim();

export async function helpCommand(ctx: CommandContext<BotContext>): Promise<void> {
  const userId = String(ctx.from?.id);
  if (!userId || userId === "undefined") return;

  const gym = await getGymByTelegramId(ctx.env.DB, userId);

  if (!gym) {
    await ctx.reply("Send /start first to register your gym.");
    return;
  }

  await ctx.reply(HELP_REGISTERED, { parse_mode: "HTML" });
}
