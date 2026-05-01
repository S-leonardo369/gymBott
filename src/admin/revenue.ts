import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getRevenueForMonth } from "../db/billing";
import { esc } from "../utils/format";
import { today } from "../utils/dates";

/**
 * /admin_revenue [YYYY-MM]
 *
 * Shows total paid revenue for the given month (defaults to current month).
 * Developer-only.
 *
 * Example: /admin_revenue 2026-04
 */
export async function adminRevenueCommand(
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

    const raw   = (ctx.match ?? "").trim();
    let month   = raw || today().slice(0, 7); // default to current month

    if (!/^\d{4}-\d{2}$/.test(month)) {
      await ctx.reply("Usage: /admin_revenue [YYYY-MM]\nExample: /admin_revenue 2026-04");
      return;
    }

    const { total, breakdown } = await getRevenueForMonth(ctx.env.DB, month);

    if (breakdown.length === 0) {
      await ctx.reply(`💰 No paid revenue for <b>${month}</b>.`, { parse_mode: "HTML" });
      return;
    }

    const lines = [
      `💰 <b>Revenue for ${month}</b>`,
      ``,
      `Total: <b>₹${total.toLocaleString()}</b> from ${breakdown.length} gym${breakdown.length !== 1 ? "s" : ""}`,
      ``,
      ...breakdown.map((r) => `• ${esc(r.gym_name)}: ₹${r.amount.toLocaleString()}`),
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (err) {
    console.error("[/admin_revenue]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
