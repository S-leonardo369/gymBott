import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { ownerKeyboard } from "../utils/keyboards";

export async function startCommand(ctx: CommandContext<BotContext>): Promise<void> {
  const userId = String(ctx.from?.id);
  if (!userId || userId === "undefined") {
    await ctx.reply("Could not identify your Telegram account. Please try again.");
    return;
  }

  const gym = await getGymByTelegramId(ctx.env.DB, userId);

  if (gym) {
    // Already registered — greet them and (re-)attach the owner keyboard
    await ctx.reply(
      `👋 Welcome back, <b>${gym.owner_name}</b> from <b>${gym.gym_name}</b>!\n\n` +
        `Use the buttons below or /help to see all commands.`,
      { parse_mode: "HTML", reply_markup: ownerKeyboard() }
    );
    return;
  }

  // Guard: don't enter a second onboarding if one is already active
  if (ctx.conversation.active("onboarding") > 0) {
    await ctx.reply(
      "You're already in the registration flow — just answer the last question, " +
        "or restart the bot if you got stuck."
    );
    return;
  }

  // New user — kick off the onboarding conversation
  await ctx.conversation.enter("onboarding");
}
