import { InlineKeyboard, type CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { listActiveMembers } from "../db/members";
import { esc } from "../utils/format";
import { formatDate } from "../utils/dates";

const MAX_PICKER = 20;

export async function cancelCommand(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const userId = String(ctx.from?.id);
    const gym    = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.reply("Please send /start first to register your gym.");
      return;
    }

    // Fetch up to MAX_PICKER + 1 so we know if there are more than we show
    const members = await listActiveMembers(ctx.env.DB, gym.id, MAX_PICKER + 1, 0);

    if (members.length === 0) {
      await ctx.reply("No active members to cancel.");
      return;
    }

    const hasMore  = members.length > MAX_PICKER;
    const shown    = members.slice(0, MAX_PICKER);
    const keyboard = new InlineKeyboard();

    for (const m of shown) {
      // Format: "Ravi Kumar — exp 02 May"
      const expShort = formatDate(m.expiry_date).slice(0, -5); // "28 Apr" — drop year
      keyboard.text(`${m.name} — exp ${expShort}`, `cancelpick:${m.id}`).row();
    }

    let text = "Select a member to cancel:";
    if (hasMore) {
      text += `\n\n<i>Showing 20 soonest-to-expire. Use /list to see all.</i>`;
    }

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  } catch (err) {
    console.error("[/cancel]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
