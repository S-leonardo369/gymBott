import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { runWeeklyBackup, type BackupEnv } from "../cron/backup";

/**
 * /admin_backup_now
 *
 * Triggers an immediate R2 backup. Developer-only.
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

    // BACKUPS binding is required; guard gracefully if not wired up yet
    const backupEnv = ctx.env as unknown as BackupEnv;
    if (!backupEnv.BACKUPS) {
      await ctx.reply(
        "⚠️ R2 BACKUPS binding is not configured. " +
          "Add it to wrangler.jsonc and re-deploy."
      );
      return;
    }

    await ctx.reply("⏳ Running backup…");

    const result = await runWeeklyBackup(backupEnv);

    await ctx.reply(
      `✅ Backup written: <code>${result.key}</code>\n` +
        `📦 Size: ${result.bytes.toLocaleString()} bytes\n` +
        `🗂 Retained: ${result.retained} | Deleted: ${result.deleted}`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("[/admin_backup_now]", err);
    await ctx.reply("Something went wrong during backup. Check logs.");
  }
}
