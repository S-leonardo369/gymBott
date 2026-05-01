/**
 * Renewal mini-conversation — entered when the gym owner taps "✅ Renewed" on
 * a cron notification.
 *
 * Entry:  ctx.conversation.enter("renewMember", memberId)
 *
 * Flow:
 *   1. Fetch gym + member (conversation.external — live DB)
 *   2. Ask amount paid, ask plan duration (initial questions)
 *   3. Pin renewalStart = today()  (before the confirm loop)
 *   4. Confirm + per-field edit loop:
 *        renewedit:amount → re-ask amount, loop back with new value
 *        renewedit:plan   → re-ask plan, recompute expiry, loop back
 *        renewconfirm     → atomic D1 batch (UPDATE member + INSERT payment)
 *        renewcancel      → exit without saving
 *
 * Safety:
 *   - gym_id is always in WHERE clauses — never trust memberId alone.
 *   - renewalStart is pinned once before the loop so repeated edits do not
 *     drift the start date.
 *   - Old status is logged before the UPDATE.
 *   - conversation.external() is used for all DB access so the live context
 *     (with env.DB) is always used, not the replayed one.
 */

import { InlineKeyboard, type Context } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { getMember, renewMemberInDb } from "../db/members";
import { today, addDays, formatDate, daysBetween } from "../utils/dates";
import { esc } from "../utils/format";
import { PLAN_OPTIONS } from "../callbacks/addMember";
import { ownerKeyboard, REPLY_KEYBOARD_TEXTS } from "../utils/keyboards";

type Conv       = Conversation<BotContext, Context>;
type PlanOption = { label: string; days: number };

// ── Sentinel thrown when the user cancels the conversation from inside askAmount()
// Caught in renewMemberConversation() so it can return normally and clear D1 state.
class ConversationCancelled extends Error {}

// ── Validators ────────────────────────────────────────────────────────────────

function validateAmount(text: string, defaultPrice: number): string | null {
  if (text.toLowerCase() === "default") return null;
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < 100 || n > 100_000) {
    return (
      `Please send a whole number between 100 and 100000, ` +
      `or <b>default</b> for ₹${defaultPrice}.`
    );
  }
  return null;
}

// ── Per-field ask helpers ─────────────────────────────────────────────────────

/**
 * Cancel handling (no conversation.skip()):
 *   /cancel or "❌ Cancel member" → replies "Cancelled", throws ConversationCancelled
 *   Other /commands or keyboard buttons → warns user and re-waits
 */
async function askAmount(
  conversation: Conv,
  ctx: Context,
  defaultPrice: number,
  prompt?: string
): Promise<number> {
  const displayPrompt =
    prompt ??
    `💰 <b>Amount paid for renewal (₹)?</b>\n` +
    `Send a number, or <b>default</b> for ₹${defaultPrice}.`;

  await ctx.reply(displayPrompt, { parse_mode: "HTML" });

  while (true) {
    const inc  = await conversation.waitFor("message:text");
    const text = inc.message.text.trim();

    // Hard cancel — exit conversation cleanly
    if (text === "/cancel" || text === "❌ Cancel member") {
      await ctx.reply("❌ Cancelled — no changes made.", { reply_markup: ownerKeyboard() });
      throw new ConversationCancelled();
    }

    // Other command or keyboard button while waiting for a value — warn and re-wait
    if (text.startsWith("/") || REPLY_KEYBOARD_TEXTS.includes(text)) {
      await ctx.reply(
        "⚠️ You're in the middle of a renewal.\n" +
          "Send /cancel to exit, or finish answering the current question.",
        { reply_markup: ownerKeyboard() }
      );
      continue;
    }

    const err  = validateAmount(text, defaultPrice);
    if (err === null) {
      return text.toLowerCase() === "default" ? defaultPrice : parseInt(text, 10);
    }
    await inc.reply(err, { parse_mode: "HTML" });
  }
}

async function askPlan(
  conversation: Conv,
  ctx: Context,
  prompt = "📅 <b>New duration?</b>"
): Promise<PlanOption> {
  const keyboard = new InlineKeyboard()
    .text("1 month",  "renew_plan:30")
    .text("3 months", "renew_plan:90")
    .row()
    .text("6 months", "renew_plan:180")
    .text("1 year",   "renew_plan:365");

  await ctx.reply(prompt, { parse_mode: "HTML", reply_markup: keyboard });

  const btn = await conversation.waitForCallbackQuery([
    "renew_plan:30",
    "renew_plan:90",
    "renew_plan:180",
    "renew_plan:365",
  ]);
  await btn.answerCallbackQuery();

  const planKey = btn.callbackQuery.data.replace("renew_", "");
  const plan    = PLAN_OPTIONS[planKey];

  await btn.editMessageText(
    `📅 Duration: <b>${plan.label}</b>`,
    { parse_mode: "HTML" }
  );
  return plan;
}

// ── Confirm-screen helpers ────────────────────────────────────────────────────

function buildConfirmText(
  memberName: string,
  amountPaid: number,
  plan: PlanOption,
  newExpiry: string
): string {
  return (
    `📋 <b>Confirm renewal:</b>\n\n` +
    `👤 ${esc(memberName)}\n` +
    `💰 ₹${amountPaid}\n` +
    `📅 ${plan.label} (${plan.days} days)\n` +
    `⏰ Valid until: <b>${formatDate(newExpiry)}</b>`
  );
}

function buildConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ Edit amount", "renewedit:amount").row()
    .text("✏️ Edit plan",   "renewedit:plan").row()
    .text("✅ Confirm", "renewconfirm").text("❌ Cancel", "renewcancel");
}

// ── Conversation ──────────────────────────────────────────────────────────────

export async function renewMemberConversation(
  conversation: Conv,
  ctx: Context,
  memberId: number
): Promise<void> {
  try {
    await _renewMemberConversationBody(conversation, ctx, memberId);
  } catch (e) {
    if (e instanceof ConversationCancelled) return;
    throw e;
  }
}

async function _renewMemberConversationBody(
  conversation: Conv,
  ctx: Context,
  memberId: number
): Promise<void> {
  // ── Step 1: fetch gym + member from live DB ─────────────────────────────────
  const gymAndMember = await conversation.external(async (outerCtx) => {
    const userId = String(outerCtx.from?.id ?? "");
    const gym    = await getGymByTelegramId(outerCtx.env.DB, userId);
    if (!gym) return null;
    const member = await getMember(outerCtx.env.DB, memberId, gym.id);
    if (!member) return null;
    return { gym, member };
  });

  if (!gymAndMember) {
    await ctx.reply(
      "❌ Member not found or your session expired. Try /list to find the member."
    );
    return;
  }

  const { gym, member } = gymAndMember;

  if (member.status === "terminated" || member.status === "cancelled") {
    await ctx.reply(
      `⚠️ <b>${esc(member.name)}</b> is already <b>${member.status}</b>. ` +
      `Use /add to register a new membership.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ── Step 2: initial questions ───────────────────────────────────────────────
  let currentAmount = await askAmount(conversation, ctx, gym.default_plan_price);
  let currentPlan   = await askPlan(conversation, ctx);

  // Pin the renewal start date before entering the confirm loop so that
  // repeated edits do not drift the start date.
  const renewalStart = await conversation.external(() => today());

  // ── Step 3: confirm + per-field edit loop ───────────────────────────────────
  while (true) {
    const newExpiry = addDays(renewalStart, currentPlan.days);
    const daysUntil = daysBetween(renewalStart, newExpiry);

    await ctx.reply(
      buildConfirmText(member.name, currentAmount, currentPlan, newExpiry),
      { parse_mode: "HTML", reply_markup: buildConfirmKeyboard() }
    );

    const btn = await conversation.waitForCallbackQuery([
      "renewedit:amount", "renewedit:plan",
      "renewconfirm", "renewcancel",
    ]);
    await btn.answerCallbackQuery();

    // ── Cancel ────────────────────────────────────────────────────────────────
    if (btn.callbackQuery.data === "renewcancel") {
      await btn.editMessageText("❌ Renewal cancelled.");
      await ctx.reply("No changes made.", { reply_markup: ownerKeyboard() });
      return;
    }

    // ── Confirm + save ────────────────────────────────────────────────────────
    if (btn.callbackQuery.data === "renewconfirm") {
      await btn.editMessageText("💾 Saving…");

      const oldStatus = member.status;
      let saved: boolean;
      try {
        saved = await conversation.external((outerCtx) =>
          renewMemberInDb(
            outerCtx.env.DB,
            memberId,
            gym.id,
            currentAmount,
            newExpiry,
            renewalStart
          )
        );
      } catch (err) {
        console.error("[renewal] DB batch failed:", err);
        await btn.editMessageText(
          "⚠️ Couldn't save the renewal. Please try again or use /add."
        );
        await ctx.reply("No changes made.", { reply_markup: ownerKeyboard() });
        return;
      }

      if (!saved) {
        await btn.editMessageText("⚠️ Member not found in DB — no changes made.");
        await ctx.reply("No changes made.", { reply_markup: ownerKeyboard() });
        return;
      }

      console.log(`[STATE] member ${memberId}: ${oldStatus} -> active (renewed)`);
      await btn.editMessageText("✅ Saved!");
      await ctx.reply(
        `✅ <b>${esc(member.name)}</b> renewed until <b>${formatDate(newExpiry)}</b> ` +
        `(${daysUntil} days).`,
        { parse_mode: "HTML", reply_markup: ownerKeyboard() }
      );
      return;
    }

    // ── Edit one field ─────────────────────────────────────────────────────────
    const field = btn.callbackQuery.data.split(":")[1]; // "amount" | "plan"
    await btn.editMessageText(`✏️ <i>Editing ${field}…</i>`, { parse_mode: "HTML" });

    if (field === "amount") {
      currentAmount = await askAmount(
        conversation, ctx, gym.default_plan_price,
        `✏️ <b>New amount paid (₹)?</b>\nSend a number, or <b>default</b> for ₹${gym.default_plan_price}.`
      );
    } else if (field === "plan") {
      currentPlan = await askPlan(
        conversation, ctx,
        "✏️ <b>New plan duration?</b>"
      );
    }
    // Loop back → re-renders confirm with updated values
  }
}
