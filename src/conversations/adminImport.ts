/**
 * Admin-import conversation — receives a CSV document, validates it, and
 * bulk-inserts the members into the target gym.
 *
 * Entry:  ctx.conversation.enter("adminImport", gymId)
 *
 * Flow:
 *   1. Wait for any message.
 *      • /cancel → reply "Import cancelled." and exit.
 *      • Text (non-command) → tell user to send a file.
 *      • Document → download, parse, validate, insert.
 *   2. On validation failure: report all errors, exit (user must send a new
 *      /admin_import command — we don't loop on failure to keep it simple).
 *   3. On success: report member ID range and count.
 *
 * All DB and network I/O is wrapped in conversation.external() so it is
 * never replayed, only its result is.
 */

import type { Context } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../index";
import { parseCsv, validateHeaders, validateRows } from "../utils/csv";
import { bulkImportMembers } from "../db/members";
import type { ImportMemberInput } from "../db/members";
import { esc } from "../utils/format";

type Conv = Conversation<BotContext, Context>;

const MAX_ROWS  = 500;
const MAX_BYTES = 1_048_576; // 1 MiB

export async function adminImportConversation(
  conversation: Conv,
  ctx: Context,
  gymId: number
): Promise<void> {
  // Keep waiting until we receive a document or /cancel.
  while (true) {
    const inc = await conversation.wait();
    const msg = inc.message;
    if (!msg) continue; // ignore non-message updates (e.g. edited messages)

    // ── /cancel ───────────────────────────────────────────────────────────────
    if (msg.text) {
      if (msg.text.trim() === "/cancel") {
        await ctx.reply("Import cancelled.");
        return;
      }
      await ctx.reply(
        "Please send the CSV as a <b>document</b> attachment, or /cancel to abort.",
        { parse_mode: "HTML" }
      );
      continue;
    }

    // ── Document received ─────────────────────────────────────────────────────
    if (!msg.document) {
      await ctx.reply(
        "Please send the CSV as a <b>document</b> attachment, or /cancel to abort.",
        { parse_mode: "HTML" }
      );
      continue;
    }

    const doc = msg.document;

    // Size guard (Telegram reports file_size for files it has cached)
    if (doc.file_size != null && doc.file_size > MAX_BYTES) {
      await ctx.reply(
        `❌ File too large (${(doc.file_size / 1024).toFixed(0)} KB). Max is 1 MB.\n` +
          `Split into multiple files and import separately.`
      );
      return;
    }

    await ctx.reply("⏳ Downloading and parsing…");

    // ── Step 1: download file ─────────────────────────────────────────────────
    const fileId = doc.file_id; // capture for closure
    let csvText: string;
    try {
      csvText = await conversation.external(async (outerCtx) => {
        const fileInfo = await outerCtx.api.getFile(fileId);
        if (!fileInfo.file_path) throw new Error("Telegram returned no file_path");
        const url = `https://api.telegram.org/file/bot${outerCtx.env.BOT_TOKEN}/${fileInfo.file_path}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`File download failed: HTTP ${resp.status}`);
        return resp.text();
      });
    } catch (err) {
      console.error("[adminImport] File download failed:", err);
      await ctx.reply(
        `❌ Couldn't download the file: <code>${esc(String(err))}</code>\n\n` +
          `Try attaching the file again, or /cancel.`,
        { parse_mode: "HTML" }
      );
      continue; // let user retry
    }

    // ── Step 2: parse CSV ─────────────────────────────────────────────────────
    const { headers, rows } = parseCsv(csvText);

    const missingHeaders = validateHeaders(headers);
    if (missingHeaders.length > 0) {
      await ctx.reply(
        `❌ Missing required column${missingHeaders.length > 1 ? "s" : ""}: ` +
          `<b>${missingHeaders.join(", ")}</b>\n\n` +
          `Expected headers (case-insensitive, any order):\n` +
          `<code>name, phone, amount_paid, admission_date, expiry_date</code>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (rows.length === 0) {
      await ctx.reply("❌ The CSV has no data rows (header row only).");
      return;
    }

    if (rows.length > MAX_ROWS) {
      await ctx.reply(
        `❌ Too many rows: <b>${rows.length}</b>. Max per import is ${MAX_ROWS}.\n` +
          `Split into multiple files.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Step 3: validate rows ─────────────────────────────────────────────────
    const { errors, valid } = validateRows(rows);

    if (errors.length > 0) {
      // Show up to 20 errors to keep the message readable
      const shown = errors.slice(0, 20);
      const lines = shown.map((e) => `Row ${e.rowNumber}: ${e.message}`);
      if (errors.length > 20) {
        lines.push(`…and ${errors.length - 20} more error(s).`);
      }

      await ctx.reply(
        `❌ Validation failed. Fix and resend:\n\n` +
          `${lines.join("\n")}\n\n` +
          `No rows imported. Fix the CSV and try again.`
      );
      return;
    }

    // ── Step 4: insert all rows atomically ────────────────────────────────────
    await ctx.reply(`✅ Validated ${valid.length} rows. Inserting…`);

    const inputRows: ImportMemberInput[] = valid.map((r) => ({
      gymId,
      name: r.name,
      phone: r.phone,
      amountPaid: r.amountPaid,
      admissionDate: r.admissionDate,
      expiryDate: r.expiryDate,
    }));

    let importResult: { firstMemberId: number; lastMemberId: number; count: number };
    try {
      importResult = await conversation.external((outerCtx) =>
        bulkImportMembers(outerCtx.env.DB, inputRows)
      );
    } catch (err) {
      console.error("[adminImport] DB batch failed:", err);
      await ctx.reply(
        `💥 Insert failed:\n<code>${esc(String(err))}</code>\n\n` +
          `The batch is atomic — no rows were inserted.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Step 5: fetch gym name for the success message ────────────────────────
    const gymName = await conversation.external((outerCtx) =>
      outerCtx.env.DB
        .prepare("SELECT gym_name FROM gyms WHERE id = ? LIMIT 1")
        .bind(gymId)
        .first<{ gym_name: string }>()
        .then((r) => r?.gym_name ?? `Gym #${gymId}`)
    );

    const count = importResult.count;
    await ctx.reply(
      `✅ Imported <b>${count}</b> member${count !== 1 ? "s" : ""} ` +
        `into Gym #${gymId} (<b>${esc(gymName)}</b>).\n\n` +
        `First member ID: <b>${importResult.firstMemberId}</b>\n` +
        `Last member ID: <b>${importResult.lastMemberId}</b>\n\n` +
        `Use /admin_gym ${gymId} to verify.`,
      { parse_mode: "HTML" }
    );
    return;
  }
}
