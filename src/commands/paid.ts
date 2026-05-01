import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { getPendingBill } from "../db/billing";
import { esc } from "../utils/format";
import { ownerKeyboard } from "../utils/keyboards";
import { sendMessage } from "../utils/telegram";

export async function paidCommand(
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

    const bill = await getPendingBill(ctx.env.DB, gym.id);
    if (!bill) {
      await ctx.reply(
        "No pending bill found. If you think this is a mistake, send /feedback.",
        { reply_markup: ownerKeyboard() }
      );
      return;
    }

    // Acknowledge the owner
    await ctx.reply(
      "✅ Got it. The developer will verify your payment shortly.\n" +
        "Service will be reactivated once confirmed.",
      { reply_markup: ownerKeyboard() }
    );

    // Forward to developer
    const devId = ctx.env.DEVELOPER_TELEGRAM_ID;
    if (devId) {
      const text =
        `💰 <b>${esc(gym.gym_name)}</b> (#${gym.id}) claims to have paid ` +
        `₹${bill.amount} for <b>${bill.billing_month}</b>.\n\n` +
        `Verify in your UPI app, then send:\n` +
        `<code>/admin_paid ${gym.id} ${bill.billing_month}</code>`;
      await sendMessage(ctx.env.BOT_TOKEN, devId, text);
    }
  } catch (err) {
    console.error("[/paid]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
