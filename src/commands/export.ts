import { InputFile, type CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { listAllMembers } from "../db/members";
import { writeCsv } from "../utils/csv";
import { esc } from "../utils/format";
import { ownerKeyboard } from "../utils/keyboards";

/** Strips characters that are illegal or awkward in filenames. */
function safeFilename(gymName: string, date: string): string {
  const safe = gymName
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50)
    .replace(/_+$/, ""); // no trailing underscores
  return `${safe || "gym"}_members_${date}.csv`;
}

export async function exportCommand(
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

    const members = await listAllMembers(ctx.env.DB, gym.id);

    if (members.length === 0) {
      await ctx.reply("No members to export.", { reply_markup: ownerKeyboard() });
      return;
    }

    const headers = [
      "id", "name", "phone", "status",
      "admission_date", "expiry_date", "amount_paid", "created_at",
    ];

    const rows = members.map((m) => [
      m.id,
      m.name,
      m.phone,
      m.status,
      m.admission_date,
      m.expiry_date,
      m.amount_paid,
      m.created_at,
    ]);

    const csvText = writeCsv(headers, rows);
    const bytes   = new TextEncoder().encode(csvText);
    const today   = new Date().toISOString().slice(0, 10);
    const filename = safeFilename(gym.gym_name, today);

    await ctx.replyWithDocument(
      new InputFile(bytes, filename),
      {
        caption:
          `${members.length} member${members.length !== 1 ? "s" : ""} — ` +
          `<b>${esc(gym.gym_name)}</b>`,
        parse_mode: "HTML",
        reply_markup: ownerKeyboard(),
      }
    );
  } catch (err) {
    console.error("[/export]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
