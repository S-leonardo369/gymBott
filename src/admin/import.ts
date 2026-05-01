/**
 * /admin_import <gym_id>
 *
 * Developer-only command to bulk-import members from a CSV file.
 *
 * Security: silently ignores any message where ctx.from.id !== DEVELOPER_TELEGRAM_ID.
 *
 * Usage:
 *   1. Send: /admin_import 3
 *   2. Bot asks you to attach a CSV document.
 *   3. Attach the CSV — bot validates and inserts all rows atomically.
 *
 * The actual file-receive / parse / insert logic lives in the
 * adminImportConversation (src/conversations/adminImport.ts). This command
 * handler just authenticates, looks up the gym, and enters the conversation.
 */

import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymById } from "../db/gyms";
import { esc } from "../utils/format";

export async function adminImportCommand(
  ctx: CommandContext<BotContext>
): Promise<void> {
  // ── Auth: silently ignore non-admin users ───────────────────────────────────
  const adminId  = ctx.env.DEVELOPER_TELEGRAM_ID;
  const callerId = String(ctx.from?.id ?? "");
  if (!adminId || callerId !== adminId) return;

  // ── Parse gym_id argument ───────────────────────────────────────────────────
  const arg = ctx.match?.trim() ?? "";

  if (!arg) {
    await ctx.reply(
      "Usage: <code>/admin_import &lt;gym_id&gt;</code>\n" +
        "Example: <code>/admin_import 3</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  if (!/^\d+$/.test(arg)) {
    await ctx.reply(
      `❌ Invalid gym_id: <code>${esc(arg)}</code>. Must be a positive integer.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const gymId = parseInt(arg, 10);
  if (gymId <= 0) {
    await ctx.reply("❌ gym_id must be greater than 0.");
    return;
  }

  // ── Look up the gym ─────────────────────────────────────────────────────────
  const gym = await getGymById(ctx.env.DB, gymId);

  if (!gym) {
    await ctx.reply(`❌ Gym ${gymId} not found.`);
    return;
  }

  if (!gym.is_active) {
    await ctx.reply(
      `❌ Gym #${gymId} (<b>${esc(gym.gym_name)}</b>) is paused — reactivate first.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ── Prompt + enter conversation ─────────────────────────────────────────────
  await ctx.reply(
    `📋 Target: Gym #${gymId} — <b>${esc(gym.gym_name)}</b> (owner: ${esc(gym.owner_name)})\n\n` +
      `Send the CSV as a <b>Telegram document</b> attachment.\n\n` +
      `<b>Required columns</b> (header row required; order doesn't matter; case-insensitive):\n` +
      `<code>name, phone, amount_paid, admission_date, expiry_date</code>\n\n` +
      `• <code>phone</code> — optional (10 digits or leave blank)\n` +
      `• <code>amount_paid</code> — integer 100–100 000\n` +
      `• <code>admission_date</code> / <code>expiry_date</code> — YYYY-MM-DD\n` +
      `• Max 500 rows per file\n\n` +
      `Send /cancel to abort.`,
    { parse_mode: "HTML" }
  );

  await ctx.conversation.enter("adminImport", gymId);
}
