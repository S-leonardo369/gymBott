import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { ownerKeyboard, guestKeyboard } from "../utils/keyboards";

const HELP_TEXT = `
<b>GymBot Commands</b>

/add — Add a new member
/list — View all active members
/expiring — Members expiring in the next 7 days
/cancel — Cancel a member's membership
/stats — Your gym statistics
/help — Show this message

📅 <b>Reminder schedule:</b> 3 days before, 2 days before, 1 day before, on expiry day, daily during grace, and at auto-termination.
`.trim();

export async function helpCommand(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const userId = String(ctx.from?.id);
    if (!userId || userId === "undefined") return;

    const gym = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.reply(
        "Send /start first to register your gym.",
        { reply_markup: guestKeyboard() }
      );
      return;
    }

    await ctx.reply(HELP_TEXT, { parse_mode: "HTML", reply_markup: ownerKeyboard() });
  } catch (err) {
    console.error("[/help]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
