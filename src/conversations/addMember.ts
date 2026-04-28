import { InlineKeyboard, type Context } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { addMember } from "../db/members";
import { today, addDays, formatDate, daysBetween } from "../utils/dates";
import { esc } from "../utils/format";
import { PLAN_OPTIONS } from "../callbacks/addMember";

type Conv = Conversation<BotContext, Context>;

// ── Validators ────────────────────────────────────────────────────────────────

function validateName(text: string): string | null {
  if (text.length < 2 || text.length > 60)
    return "Please send a name between 2 and 60 characters.";
  return null;
}

function validatePhone(text: string): string | null {
  if (text.toLowerCase() === "skip") return null;
  if (!/^\d{10}$/.test(text))
    return "Please send 10 digits like 9876543210, or 'skip'.";
  return null;
}

function validateAmount(text: string, defaultPrice: number): string | null {
  if (text.toLowerCase() === "default") return null;
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < 100 || n > 100_000)
    return `Please send a whole number between 100 and 100000, or 'default' for ₹${defaultPrice}.`;
  return null;
}

// ── Helper: ask one question, loop on invalid input ──────────────────────────

async function ask(
  conversation: Conv,
  ctx: Context,
  prompt: string,
  validator: (text: string) => string | null
): Promise<string> {
  await ctx.reply(prompt, { parse_mode: "HTML" });
  while (true) {
    const inc = await conversation.waitFor("message:text");
    const text = inc.message.text.trim();
    const err  = validator(text);
    if (err === null) return text;
    await inc.reply(err);
  }
}

// ── Main conversation ─────────────────────────────────────────────────────────

export async function addMemberConversation(
  conversation: Conv,
  ctx: Context
): Promise<void> {
  // Fetch gym once at conversation start (cached — not re-run on replay).
  const gym = await conversation.external((outerCtx) =>
    getGymByTelegramId(outerCtx.env.DB, String(outerCtx.from?.id ?? ""))
  );

  if (!gym) {
    await ctx.reply("Please send /start first to register your gym.");
    return;
  }

  // ── Q1: Member name ───────────────────────────────────────────────────────
  const name = await ask(
    conversation, ctx,
    "👤 <b>Member name?</b>",
    validateName
  );

  // ── Q2: Phone ─────────────────────────────────────────────────────────────
  const phoneRaw = await ask(
    conversation, ctx,
    "📞 <b>Phone?</b> (10 digits, or send 'skip')",
    validatePhone
  );
  const phone = phoneRaw.toLowerCase() === "skip" ? null : phoneRaw;

  // ── Q3: Amount paid ───────────────────────────────────────────────────────
  const amountRaw = await ask(
    conversation, ctx,
    `💰 <b>Amount paid (₹)?</b>\nSend a number, or <b>default</b> to use ₹${gym.default_plan_price}.`,
    (t) => validateAmount(t, gym.default_plan_price)
  );
  const amountPaid =
    amountRaw.toLowerCase() === "default"
      ? gym.default_plan_price
      : parseInt(amountRaw, 10);

  // ── Q4: Plan duration (inline keyboard) ───────────────────────────────────
  const planKeyboard = new InlineKeyboard()
    .text("1 month",  "plan:30")
    .text("3 months", "plan:90")
    .row()
    .text("6 months", "plan:180")
    .text("1 year",   "plan:365");

  await ctx.reply("📅 <b>Plan duration?</b>", {
    parse_mode: "HTML",
    reply_markup: planKeyboard,
  });

  const planBtn = await conversation.waitForCallbackQuery(
    Object.keys(PLAN_OPTIONS)
  );
  await planBtn.answerCallbackQuery();

  const plan          = PLAN_OPTIONS[planBtn.callbackQuery.data];
  const admissionDate = today();
  const expiryDate    = addDays(admissionDate, plan.days);

  await planBtn.editMessageText(
    `📅 Plan: <b>${plan.label} (${plan.days} days)</b>`,
    { parse_mode: "HTML" }
  );

  // ── Q5: Summary + confirm ─────────────────────────────────────────────────
  const daysUntil = daysBetween(admissionDate, expiryDate);
  const summary =
    `📋 <b>Confirm new member:</b>\n\n` +
    `👤 Name: ${esc(name)}\n` +
    `📞 Phone: ${phone ? esc(phone) : "—"}\n` +
    `💰 Paid: ₹${amountPaid}\n` +
    `📅 Plan: ${plan.label} (${plan.days} days)\n` +
    `🗓 Admission: ${formatDate(admissionDate)}\n` +
    `⏰ Expires: ${formatDate(expiryDate)}`;

  const confirmKeyboard = new InlineKeyboard()
    .text("✅ Save", "addsave")
    .text("❌ Cancel", "addcancel");

  await ctx.reply(summary, { parse_mode: "HTML", reply_markup: confirmKeyboard });

  const confirmBtn = await conversation.waitForCallbackQuery(["addsave", "addcancel"]);
  await confirmBtn.answerCallbackQuery();

  if (confirmBtn.callbackQuery.data === "addcancel") {
    await confirmBtn.editMessageText("❌ Cancelled. Nothing saved.");
    return;
  }

  // ── Save atomically via D1 batch ──────────────────────────────────────────
  let memberId: number;
  try {
    memberId = await conversation.external((outerCtx) =>
      addMember(outerCtx.env.DB, {
        gymId: gym.id,
        name,
        phone,
        amountPaid,
        admissionDate,
        expiryDate,
      })
    );
  } catch (err) {
    console.error("[/add] DB batch failed:", err);
    await confirmBtn.editMessageText(
      "Sorry, couldn't save. Try /add again."
    );
    return;
  }

  await confirmBtn.editMessageText(
    `✅ Added <b>${esc(name)}</b> (ID #${memberId}).\n` +
      `Expires <b>${formatDate(expiryDate)}</b> (${daysUntil} days from now).`,
    { parse_mode: "HTML" }
  );
}
