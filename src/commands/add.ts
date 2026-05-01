import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { ownerKeyboard, guestKeyboard } from "../utils/keyboards";

export async function addCommand(ctx: CommandContext<BotContext>): Promise<void> {
  try {
    const userId = String(ctx.from?.id);
    if (!userId || userId === "undefined") return;

    const gym = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.reply(
        "Please send /start first to register your gym.",
        { reply_markup: guestKeyboard() }
      );
      return;
    }

    if (ctx.conversation.active("addMember") > 0) {
      await ctx.reply(
        "You're already in the middle of adding a member. " +
          "Complete that first, or send /cancel to abort it.",
        { reply_markup: ownerKeyboard() }
      );
      return;
    }

    await ctx.conversation.enter("addMember");
  } catch (err) {
    console.error("[/add]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
