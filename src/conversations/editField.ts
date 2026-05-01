/**
 * editField conversation — entered from the editfield:<field>:<id> callback.
 *
 * Asks the owner for one new field value, validates it, saves it, then
 * re-renders the member detail card so they can edit another field or tap Done.
 *
 * Supported fields: "name" | "phone" | "amount" | "expiry"
 *
 * Cancel handling: /cancel or "❌ Cancel member" → exit with
 * "❌ Edit cancelled. Member unchanged."
 */

import type { Context } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { getMember, updateMemberField } from "../db/members";
import type { EditableField } from "../db/members";
import { isValidDate } from "../utils/csv";
import { esc } from "../utils/format";
import { ownerKeyboard, REPLY_KEYBOARD_TEXTS } from "../utils/keyboards";
import { buildDetailCard, buildFieldKeyboard } from "../callbacks/edit";

type Conv = Conversation<BotContext, Context>;

// ── Sentinel ──────────────────────────────────────────────────────────────────

class ConversationCancelled extends Error {}

// ── Field prompt + validator ──────────────────────────────────────────────────

function fieldPrompt(field: string): string {
  switch (field) {
    case "name":   return "👤 <b>New name?</b> (2–60 characters)";
    case "phone":  return "📞 <b>New phone?</b> (10 digits, or 'skip' to remove)";
    case "amount": return "💰 <b>New amount paid (₹)?</b> (whole number 100–100 000)";
    case "expiry": return "📅 <b>New expiry date?</b> (YYYY-MM-DD — past dates allowed)";
    default:       return `New value for ${field}?`;
  }
}

interface FieldResult {
  error: string | null;
  value: string | number | null;
}

function validateInput(field: string, text: string): FieldResult {
  switch (field) {
    case "name": {
      if (text.length < 2 || text.length > 60)
        return { error: "Name must be 2–60 characters.", value: null };
      return { error: null, value: text };
    }
    case "phone": {
      if (text.toLowerCase() === "skip") return { error: null, value: null };
      if (!/^\d{10}$/.test(text))
        return { error: "Phone must be 10 digits, or 'skip' to remove.", value: null };
      return { error: null, value: text };
    }
    case "amount": {
      const n = Number(text);
      if (!Number.isInteger(n) || n < 100 || n > 100_000)
        return {
          error: "Amount must be a whole number between 100 and 100 000.",
          value: null,
        };
      return { error: null, value: n };
    }
    case "expiry": {
      if (!isValidDate(text))
        return {
          error: "Enter a valid date in YYYY-MM-DD format (e.g. 2026-12-31).",
          value: null,
        };
      return { error: null, value: text };
    }
    default:
      return { error: "Unknown field.", value: null };
  }
}

// ── Conversation ──────────────────────────────────────────────────────────────

export async function editFieldConversation(
  conversation: Conv,
  ctx: Context,
  field: string,
  memberId: number
): Promise<void> {
  try {
    await _editFieldBody(conversation, ctx, field, memberId);
  } catch (e) {
    if (e instanceof ConversationCancelled) return;
    throw e;
  }
}

async function _editFieldBody(
  conversation: Conv,
  ctx: Context,
  field: string,
  memberId: number
): Promise<void> {
  // ── Fetch gym + member ──────────────────────────────────────────────────────
  const gymAndMember = await conversation.external(async (outerCtx) => {
    const userId = String(outerCtx.from?.id ?? "");
    const gym    = await getGymByTelegramId(outerCtx.env.DB, userId);
    if (!gym) return null;
    const member = await getMember(outerCtx.env.DB, memberId, gym.id);
    if (!member) return null;
    return { gym, member };
  });

  if (!gymAndMember) {
    await ctx.reply("❌ Member not found. They may have been removed.");
    return;
  }

  const { gym } = gymAndMember;

  // ── Ask for new value ───────────────────────────────────────────────────────
  await ctx.reply(fieldPrompt(field), { parse_mode: "HTML" });

  while (true) {
    const inc  = await conversation.waitFor("message:text");
    const text = inc.message.text.trim();

    // Hard cancel
    if (text === "/cancel" || text === "❌ Cancel member") {
      await ctx.reply(
        "❌ Edit cancelled. Member unchanged.",
        { reply_markup: ownerKeyboard() }
      );
      throw new ConversationCancelled();
    }

    // Other command / keyboard button while in edit — warn and re-wait
    if (text.startsWith("/") || REPLY_KEYBOARD_TEXTS.includes(text)) {
      await ctx.reply(
        "⚠️ You're in the middle of an edit.\n" +
          "Send /cancel to abort, or send the new value.",
        { reply_markup: ownerKeyboard() }
      );
      continue;
    }

    const { error, value } = validateInput(field, text);
    if (error) {
      await inc.reply(error);
      continue;
    }

    // ── Save ──────────────────────────────────────────────────────────────────
    const { oldValue, updated } = await conversation.external((outerCtx) =>
      updateMemberField(
        outerCtx.env.DB,
        memberId,
        gym.id,
        field as EditableField,
        value
      )
    );

    if (!updated) {
      await ctx.reply(
        "❌ Couldn't save — member may have been removed.",
        { reply_markup: ownerKeyboard() }
      );
      return;
    }

    console.log(
      `[EDIT] member ${memberId} field=${field} old=${oldValue} new=${value}`
    );

    // ── Fetch updated member and re-render detail card ────────────────────────
    const updated_member = await conversation.external((outerCtx) =>
      getMember(outerCtx.env.DB, memberId, gym.id)
    );

    if (!updated_member) {
      await ctx.reply(
        `✅ <b>${esc(field)}</b> updated.`,
        { parse_mode: "HTML", reply_markup: ownerKeyboard() }
      );
      return;
    }

    await ctx.reply(buildDetailCard(updated_member), {
      parse_mode: "HTML",
      reply_markup: buildFieldKeyboard(memberId),
    });
    return;
  }
}
