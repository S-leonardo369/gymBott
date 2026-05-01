import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymBillingSummaries } from "../db/billing";
import { esc } from "../utils/format";
import { today, formatDate } from "../utils/dates";

/**
 * /admin_gyms
 *
 * Lists all registered gyms with their member count and current-month
 * billing status. Developer-only.
 */
export async function adminGymsCommand(
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

    const dateStr     = today();
    const billingMonth = dateStr.slice(0, 7);

    const gyms = await getGymBillingSummaries(ctx.env.DB, billingMonth, dateStr);

    if (gyms.length === 0) {
      await ctx.reply("No gyms registered yet.");
      return;
    }

    const lines: string[] = [
      `🏋️ <b>Gyms Overview — ${billingMonth}</b>`,
      `<i>Total: ${gyms.length}</i>`,
      "",
    ];

    for (const g of gyms) {
      const activeLabel = g.is_active === 1 ? "✅ Active" : "🛑 Paused";
      const memberStr   = `👤 ${g.member_count} member${g.member_count !== 1 ? "s" : ""}`;

      let billStr: string;
      switch (g.bill_status) {
        case "paid":
          billStr = `💳 Paid ₹${g.bill_amount}`;
          break;
        case "pending":
          billStr = `⏳ Pending ₹${g.bill_amount}`;
          break;
        case "free_trial":
          billStr = `🎁 Trial until ${g.trial_ends_on ? formatDate(g.trial_ends_on) : "?"}`;
          break;
        default:
          billStr = `— No bill (0 members)`;
      }

      lines.push(
        `<b>#${g.id} ${esc(g.gym_name)}</b> · ${esc(g.owner_name)}`,
        `   ${memberStr} | ${activeLabel}`,
        `   ${billStr}`,
        ""
      );
    }

    // Telegram message limit is 4096 chars — split if needed
    const fullText = lines.join("\n");
    if (fullText.length <= 4096) {
      await ctx.reply(fullText, { parse_mode: "HTML" });
    } else {
      // Send in chunks
      let chunk = "";
      for (const line of lines) {
        if ((chunk + line + "\n").length > 4000) {
          await ctx.reply(chunk, { parse_mode: "HTML" });
          chunk = "";
        }
        chunk += line + "\n";
      }
      if (chunk.trim()) await ctx.reply(chunk, { parse_mode: "HTML" });
    }
  } catch (err) {
    console.error("[/admin_gyms]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
