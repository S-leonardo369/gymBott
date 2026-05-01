import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymById } from "../db/gyms";
import { markBillPaid } from "../db/billing";
import { esc } from "../utils/format";
import { today } from "../utils/dates";

/**
 * /admin_paid <gym_id> <billing_month>
 *
 * Marks the given month's bill as paid, reactivates the gym, and notifies
 * the owner. Developer-only.
 *
 * Example: /admin_paid 3 2026-05
 */
export async function adminMarkPaidCommand(
  ctx: CommandContext<BotContext>
): Promise<void> {
  try {
    const userId = String(ctx.from?.id);
    if (
      !ctx.env.DEVELOPER_TELEGRAM_ID ||
      userId !== ctx.env.DEVELOPER_TELEGRAM_ID
    ) {
      return;
    }

    const parts = (ctx.match ?? "").trim().split(/\s+/);
    if (parts.length < 2) {
      await ctx.reply("Usage: /admin_paid <gym_id> <billing_month>\nExample: /admin_paid 3 2026-05");
      return;
    }

    const gymId       = parseInt(parts[0], 10);
    const billingMonth = parts[1]; // 'YYYY-MM'

    if (!Number.isInteger(gymId) || gymId <= 0) {
      await ctx.reply("Invalid gym ID.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
      await ctx.reply("Invalid billing month — use YYYY-MM format (e.g. 2026-05).");
      return;
    }

    const gym = await getGymById(ctx.env.DB, gymId);
    if (!gym) {
      await ctx.reply(`No gym found with ID ${gymId}.`);
      return;
    }

    const updated = await markBillPaid(ctx.env.DB, gymId, billingMonth, today());
    if (!updated) {
      await ctx.reply(
        `No pending bill found for gym #${gymId} (${gym.gym_name}) in ${billingMonth}.`
      );
      return;
    }

    // Notify the gym owner
    await ctx.api.sendMessage(
      gym.telegram_user_id,
      `✅ Payment confirmed for <b>${billingMonth}</b>. Service is active. Thank you! 🙏`,
      { parse_mode: "HTML" }
    );

    // Confirm to the developer
    await ctx.reply(
      `✅ Marked as paid. <b>${esc(gym.gym_name)}</b> (#${gymId}) reactivated.`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("[/admin_paid]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
