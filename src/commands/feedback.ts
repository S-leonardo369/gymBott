import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";

export async function feedbackCommand(
  ctx: CommandContext<BotContext>
): Promise<void> {
  try {
    const userId = String(ctx.from?.id);
    if (!userId || userId === "undefined") return;

    const gym = await getGymByTelegramId(ctx.env.DB, userId);
    if (!gym) {
      await ctx.reply("Please send /start first to register your gym.");
      return;
    }

    await ctx.conversation.enter("feedback");
  } catch (err) {
    console.error("[/feedback]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
