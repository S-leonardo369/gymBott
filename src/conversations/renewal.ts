/**
 * Renewal mini-conversation — entered when the gym owner taps "✅ Renewed" on
 * a cron notification.
 *
 * Entry:  ctx.conversation.enter("renewMember", memberId)
 * Flow:
 *   1. Fetch gym + member (via conversation.external — gets live DB access)
 *   2. Ask amount paid (free text or "default")
 *   3. Ask new duration (inline plan keyboard)
 *   4. Show confirmation summary
 *   5. Atomic D1 batch: UPDATE members + INSERT member_payments
 *   6. Reply with success / error
 *
 * Safety:
 *   - gym_id is always included in WHERE clauses (never trust memberId alone)
 *   - old status is logged before the UPDATE
 *   - conversation.external() ensures DB calls use the live outside context
 *     (which has env.DB), not the replayed context
 */

import { InlineKeyboard, type Context } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { getMember, renewMemberInDb } from "../db/members";
import { today, addDays, formatDate, daysBetween } from "../utils/dates";
import { esc } from "../utils/format";
import { PLAN_OPTIONS } from "../callbacks/addMember";

type Conv = Conversation<BotContext, Context>;

// ── Amount validator (mirrors addMember) ──────────────────────────────────────

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

// ── Conversation ──────────────────────────────────────────────────────────────

export async function renewMemberConversation(
  conversation: Conv,
  ctx: Context,
  memberId: number
): Promise<void> {
  // ── Step 1: fetch gym + member from live DB ─────────────────────────────────
  // conversation.external() caches the result on first run and replays it on
  // subsequent steps — it does NOT re-run the DB query on every replay.
  const gymAndMember = await conversation.external(async (outerCtx) => {
    const userId = String(outerCtx.from?.id ?? "");
    const gym    = await getGymByTelegramId(outerCtx.env.DB, userId);
    if (!gym) return null;
    const member = await getMember(outerCtx.env.DB, memberId, gym.id);
    if (!member) return null;
    // Return plain objects (must be JSON-serialisable for conversation state)
    return { gym, member };
  });

  if (!gymAndMember) {
    await ctx.reply("❌ Member not found or your session expired. Try /list to find the member.");
    return;
  }

  const { gym, member } = gymAndMember;

  // Only allow renewal for active / expired members
  if (member.status === "terminated" || member.status === "cancelled") {
    await ctx.reply(
      `⚠️ <b>${esc(member.name)}</b> is already <b>${member.status}</b>. ` +
      `Use /add to register a new membership.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // ── Step 2: amount paid ─────────────────────────────────────────────────────
  await ctx.reply(
    `💰 <b>Amount paid for renewal (₹)?</b>\n` +
    `Send a number, or <b>default</b> for ₹${gym.default_plan_price}.`,
    { parse_mode: "HTML" }
  );

  let amountPaid: number;
  while (true) {
    const inc  = await conversation.waitFor("message:text");
    const text = inc.message.text.trim();
    const err  = validateAmount(text, gym.default_plan_price);
    if (err === null) {
      amountPaid =
        text.toLowerCase() === "default"
          ? gym.default_plan_price
          : parseInt(text, 10);
      break;
    }
    await inc.reply(err, { parse_mode: "HTML" });
  }

  // ── Step 3: plan duration ───────────────────────────────────────────────────
  const planKeyboard = new InlineKeyboard()
    .text("1 month",  "renew_plan:30")
    .text("3 months", "renew_plan:90")
    .row()
    .text("6 months", "renew_plan:180")
    .text("1 year",   "renew_plan:365");

  await ctx.reply("📅 <b>New duration?</b>", {
    parse_mode: "HTML",
    reply_markup: planKeyboard,
  });

  const planBtn = await conversation.waitForCallbackQuery([
    "renew_plan:30",
    "renew_plan:90",
    "renew_plan:180",
    "renew_plan:365",
  ]);
  await planBtn.answerCallbackQuery();

  // Map renew_plan:30 → plan:30 so we can reuse PLAN_OPTIONS
  const planKey = planBtn.callbackQuery.data.replace("renew_", ""); // e.g. "plan:30"
  const plan    = PLAN_OPTIONS[planKey];

  // Compute dates inside conversation.external so the value is pinned at the
  // moment the step first executes (not re-derived on every replay).
  const { renewalStart, newExpiry } = await conversation.external(() => {
    const start = today();
    return { renewalStart: start, newExpiry: addDays(start, plan.days) };
  });

  await planBtn.editMessageText(
    `📅 Duration: <b>${plan.label}</b>`,
    { parse_mode: "HTML" }
  );

  // ── Step 4: confirmation ────────────────────────────────────────────────────
  const daysUntil        = daysBetween(renewalStart, newExpiry);
  const confirmKeyboard  = new InlineKeyboard()
    .text("✅ Confirm", "renewconfirm")
    .text("❌ Cancel",  "renewcancel");

  await ctx.reply(
    `📋 <b>Confirm renewal:</b>\n\n` +
    `👤 ${esc(member.name)}\n` +
    `💰 ₹${amountPaid}\n` +
    `📅 ${plan.label} (${plan.days} days)\n` +
    `⏰ Valid until: <b>${formatDate(newExpiry)}</b>`,
    { parse_mode: "HTML", reply_markup: confirmKeyboard }
  );

  const confirmBtn = await conversation.waitForCallbackQuery(["renewconfirm", "renewcancel"]);
  await confirmBtn.answerCallbackQuery();

  if (confirmBtn.callbackQuery.data === "renewcancel") {
    await confirmBtn.editMessageText("❌ Renewal cancelled — no changes made.");
    return;
  }

  // ── Step 5: atomic save ─────────────────────────────────────────────────────
  const oldStatus = member.status;
  let saved: boolean;
  try {
    saved = await conversation.external((outerCtx) =>
      renewMemberInDb(
        outerCtx.env.DB,
        memberId,
        gym.id,
        amountPaid,
        newExpiry,
        renewalStart
      )
    );
  } catch (err) {
    console.error("[renewal] DB batch failed:", err);
    await confirmBtn.editMessageText(
      "⚠️ Couldn't save the renewal. Please try again or use /add."
    );
    return;
  }

  if (!saved) {
    await confirmBtn.editMessageText(
      "⚠️ Member not found in DB — no changes made."
    );
    return;
  }

  console.log(`[STATE] member ${memberId}: ${oldStatus} -> active (renewed)`);

  await confirmBtn.editMessageText(
    `✅ <b>${esc(member.name)}</b> renewed until <b>${formatDate(newExpiry)}</b> ` +
    `(${daysUntil} days).`,
    { parse_mode: "HTML" }
  );
}
