/**
 * /admin_run_cron [YYYY-MM-DD]
 *
 * Developer-only command to manually trigger the daily cron with an optional
 * date override — essential for testing all notification categories without
 * waiting real days.
 *
 * Security:
 *   - Silently ignores any message where ctx.from.id !== DEVELOPER_TELEGRAM_ID.
 *     No error is sent so the command is invisible to non-admins.
 *   - DEVELOPER_TELEGRAM_ID is set as a Wrangler secret (never in code).
 *
 * Usage:
 *   /admin_run_cron              → run for today (UTC)
 *   /admin_run_cron 2026-05-01  → simulate cron firing on 2026-05-01
 *
 * Reply format:
 *   ✅ Cron ran for 2026-05-01:
 *   🏋️ Gyms processed: 2
 *   📬 Notifications sent: 5
 *   ❌ Auto-terminations: 1
 *   ⚠️ Errors: 0
 */

import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { runDailyCron } from "../cron/daily";
import { today } from "../utils/dates";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function adminRunCronCommand(
  ctx: CommandContext<BotContext>
): Promise<void> {
  // ── Auth: silently ignore non-admin users ───────────────────────────────────
  const adminId = ctx.env.DEVELOPER_TELEGRAM_ID;
  const callerId = String(ctx.from?.id ?? "");

  if (!adminId || callerId !== adminId) {
    // Intentionally no reply — command appears to not exist for non-admins
    return;
  }

  // ── Parse optional date argument ────────────────────────────────────────────
  const arg = ctx.match?.trim() ?? "";
  let overrideDate: string | undefined;

  if (arg) {
    if (!DATE_RE.test(arg)) {
      await ctx.reply(
        "⚠️ Invalid date format.\n\n" +
        "Usage: <code>/admin_run_cron YYYY-MM-DD</code>\n" +
        "Example: <code>/admin_run_cron 2026-05-01</code>",
        { parse_mode: "HTML" }
      );
      return;
    }
    overrideDate = arg;
  }

  const targetDate = overrideDate ?? today();
  await ctx.reply(`⏳ Running cron for <b>${targetDate}</b>…`, { parse_mode: "HTML" });

  // ── Run cron ────────────────────────────────────────────────────────────────
  try {
    const result = await runDailyCron(ctx.env, overrideDate);

    await ctx.reply(
      `✅ Cron ran for <b>${result.date}</b>:\n\n` +
      `🏋️ Gyms processed: <b>${result.gymsProcessed}</b>\n` +
      `📬 Notifications sent: <b>${result.notificationsSent}</b>\n` +
      `❌ Auto-terminations: <b>${result.autoTerminations}</b>\n` +
      `⚠️ Errors: <b>${result.errors}</b>`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("[/admin_run_cron] Unhandled error:", err);
    await ctx.reply(`💥 Cron threw an error:\n<code>${String(err)}</code>`, {
      parse_mode: "HTML",
    });
  }
}
