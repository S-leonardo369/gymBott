import { InlineKeyboard, type CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { listActiveMembers } from "../db/members";
import { formatDate } from "../utils/dates";
import { ownerKeyboard } from "../utils/keyboards";

const MAX_PICKER = 20;

export async function editCommand(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const userId = String(ctx.from?.id);
    if (!userId || userId === "undefined") return;

    const gym = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.reply("Please send /start first to register your gym.");
      return;
    }

    const members = await listActiveMembers(ctx.env.DB, gym.id, MAX_PICKER + 1, 0);

    if (members.length === 0) {
      await ctx.reply("No active members to edit.", { reply_markup: ownerKeyboard() });
      return;
    }

    const hasMore = members.length > MAX_PICKER;
    const shown   = members.slice(0, MAX_PICKER);
    const keyboard = new InlineKeyboard();

    for (const m of shown) {
      const expShort = formatDate(m.expiry_date).slice(0, -5); // "28 Apr"
      keyboard.text(`${m.name} — exp ${expShort}`, `editpick:${m.id}`).row();
    }

    let text = "Select a member to edit:";
    if (hasMore) {
      text += `\n\n<i>Showing 20 soonest-to-expire. Use /list to see all.</i>`;
    }

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  } catch (err) {
    console.error("[/edit]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
