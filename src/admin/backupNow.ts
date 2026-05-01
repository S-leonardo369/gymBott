import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { runWeeklyBackup } from "../cron/backup";

/**
 * /admin_backup_now
 *
 * Triggers an immediate Telegram backup. Developer-only.
 */
export async function adminBackupNowCommand(
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

    await ctx.reply("⏳ Running backup…");

    const result = await runWeeklyBackup(ctx.env);

    if (!result.sent) {
      await ctx.reply(
        "⚠️ Backup failed — check logs. DEVELOPER_TELEGRAM_ID may not be set."
      );
      return;
    }

    await ctx.reply(
      `✅ Backup sent to your Telegram (${result.bytes.toLocaleString()} bytes).\n` +
        `Gyms: ${result.gyms}, Members: ${result.members}, Payments: ${result.payments}`
    );
  } catch (err) {
    console.error("[/admin_backup_now]", err);
    await ctx.reply("Something went wrong during backup. Check logs.");
  }
}
