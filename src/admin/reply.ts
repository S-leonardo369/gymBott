import type { CommandContext } from "grammy";
import type { BotContext } from "../index";
import { getGymById } from "../db/gyms";
import { esc } from "../utils/format";

/**
 * /admin_reply <gym_id> <message>
 *
 * Sends a reply from the developer to a gym owner.
 * Developer-only; gate is DEVELOPER_TELEGRAM_ID.
 */
export async function adminReplyCommand(
  ctx: CommandContext<BotContext>
): Promise<void> {
  try {
    const userId = String(ctx.from?.id);

    if (
      !ctx.env.DEVELOPER_TELEGRAM_ID ||
      userId !== ctx.env.DEVELOPER_TELEGRAM_ID
    ) {
      return; // Silently ignore — don't leak admin commands to non-admins
    }

    // ctx.match = everything after "/admin_reply "
    const raw = (ctx.match ?? "").trim();
    const spaceIdx = raw.indexOf(" ");

    if (spaceIdx === -1) {
      await ctx.reply("Usage: /admin_reply <gym_id> <message>");
      return;
    }

    const gymIdStr = raw.slice(0, spaceIdx).trim();
    const message  = raw.slice(spaceIdx + 1).trim();
    const gymId    = parseInt(gymIdStr, 10);

    if (!Number.isInteger(gymId) || gymId <= 0) {
      await ctx.reply("Invalid gym ID — must be a positive integer.");
      return;
    }

    if (!message) {
      await ctx.reply("Message cannot be empty.");
      return;
    }

    const gym = await getGymById(ctx.env.DB, gymId);
    if (!gym) {
      await ctx.reply(`No gym found with ID ${gymId}.`);
      return;
    }

    const text =
      `💬 <b>Reply from developer:</b>\n\n${esc(message)}`;

    await ctx.api.sendMessage(gym.telegram_user_id, text, {
      parse_mode: "HTML",
    });

    await ctx.reply(
      `✅ Reply sent to <b>${esc(gym.gym_name)}</b> (#${gym.id}).`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    console.error("[/admin_reply]", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
}
