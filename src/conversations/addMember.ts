import { InlineKeyboard, type Context } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import type { BotContext } from "../index";
import { getGymByTelegramId } from "../db/gyms";
import { addMember } from "../db/members";
import { today, addDays, formatDate, daysBetween } from "../utils/dates";
import { esc } from "../utils/format";
import { PLAN_OPTIONS } from "../callbacks/addMember";
import { ownerKeyboard, REPLY_KEYBOARD_TEXTS } from "../utils/keyboards";

type Conv       = Conversation<BotContext, Context>;
type PlanOption = { label: string; days: number };

// ── Sentinel thrown when the user cancels the conversation from inside ask() ──
// Caught in addMemberConversation() so the function can return normally,
// which causes the conversations plugin to clear the D1 state.
class ConversationCancelled extends Error {}

// ── Validators ────────────────────────────────────────────────────────────────
// Exported so tests can import them directly if needed.

export function validateName(text: string): string | null {
  if (text.length < 2 || text.length > 60)
    return "Please send a name between 2 and 60 characters.";
  return null;
}

export function validatePhone(text: string): string | null {
  if (text.toLowerCase() === "skip") return null;
  if (!/^\d{10}$/.test(text))
    return "Please send 10 digits like 9876543210, or 'skip'.";
  return null;
}

export function validateAmount(text: string, defaultPrice: number): string | null {
  if (text.toLowerCase() === "default") return null;
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < 100 || n > 100_000)
    return `Please send a whole number between 100 and 100000, or 'default' for ₹${defaultPrice}.`;
  return null;
}

// ── Low-level ask helper ──────────────────────────────────────────────────────

/**
 * Sends `prompt`, then loops until the user sends a message that passes
 * `validator`. Returns the validated text.
 *
 * Cancel handling (no conversation.skip() — see bug notes):
 *   /cancel or "❌ Cancel member" → replies "Cancelled", throws ConversationCancelled
 *   Other /commands or keyboard buttons → replies a warning, loops back (re-waits)
 */
async function ask(
  conversation: Conv,
  ctx: Context,
  prompt: string,
  validator: (text: string) => string | null
): Promise<string> {
  await ctx.reply(prompt, { parse_mode: "HTML" });
  while (true) {
    const inc  = await conversation.waitFor("message:text");
    const text = inc.message.text.trim();

    // Hard cancel — exit conversation cleanly
    if (text === "/cancel" || text === "❌ Cancel member") {
      await ctx.reply("❌ Cancelled — nothing saved.", { reply_markup: ownerKeyboard() });
      throw new ConversationCancelled();
    }

    // Other command or keyboard button while we're waiting for a field value —
    // warn the user and re-wait for the same field (don't exit)
    if (text.startsWith("/") || REPLY_KEYBOARD_TEXTS.includes(text)) {
      await ctx.reply(
        "⚠️ You're in the middle of adding a member.\n" +
          "Send /cancel to exit, or finish answering the current question.",
        { reply_markup: ownerKeyboard() }
      );
      continue;
    }

    const err  = validator(text);
    if (err === null) return text;
    await inc.reply(err);
  }
}

// ── Per-field ask helpers — used for both initial questions and edits ──────────

async function askName(
  conversation: Conv,
  ctx: Context,
  prompt = "👤 <b>Member name?</b>"
): Promise<string> {
  return ask(conversation, ctx, prompt, validateName);
}

async function askPhone(
  conversation: Conv,
  ctx: Context,
  prompt = "📞 <b>Phone?</b> (10 digits, or send 'skip')"
): Promise<string | null> {
  const raw = await ask(conversation, ctx, prompt, validatePhone);
  return raw.toLowerCase() === "skip" ? null : raw;
}

async function askAmount(
  conversation: Conv,
  ctx: Context,
  defaultPrice: number,
  prompt?: string
): Promise<number> {
  const displayPrompt =
    prompt ??
    `💰 <b>Amount paid (₹)?</b>\nSend a number, or <b>default</b> to use ₹${defaultPrice}.`;
  const raw = await ask(
    conversation, ctx, displayPrompt,
    (t) => validateAmount(t, defaultPrice)
  );
  return raw.toLowerCase() === "default" ? defaultPrice : parseInt(raw, 10);
}

async function askPlan(
  conversation: Conv,
  ctx: Context,
  prompt = "📅 <b>Plan duration?</b>"
): Promise<PlanOption> {
  const keyboard = new InlineKeyboard()
    .text("1 month",  "plan:30")
    .text("3 months", "plan:90")
    .row()
    .text("6 months", "plan:180")
    .text("1 year",   "plan:365");

  await ctx.reply(prompt, { parse_mode: "HTML", reply_markup: keyboard });

  const btn  = await conversation.waitForCallbackQuery(Object.keys(PLAN_OPTIONS));
  await btn.answerCallbackQuery();
  const plan = PLAN_OPTIONS[btn.callbackQuery.data];

  await btn.editMessageText(
    `📅 Plan: <b>${plan.label} (${plan.days} days)</b>`,
    { parse_mode: "HTML" }
  );
  return plan;
}

// ── Confirm-screen helpers ────────────────────────────────────────────────────

function buildConfirmText(
  name: string,
  phone: string | null,
  amountPaid: number,
  plan: PlanOption,
  admissionDate: string,
  expiryDate: string
): string {
  return (
    `📋 <b>Confirm new member:</b>\n\n` +
    `👤 Name: ${esc(name)}\n` +
    `📞 Phone: ${phone ? esc(phone) : "—"}\n` +
    `💰 Paid: ₹${amountPaid}\n` +
    `📅 Plan: ${plan.label} (${plan.days} days)\n` +
    `🗓 Admission: ${formatDate(admissionDate)}\n` +
    `⏰ Expires: ${formatDate(expiryDate)}`
  );
}

function buildConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ Edit name",  "addedit:name").row()
    .text("✏️ Edit phone", "addedit:phone").row()
    .text("✏️ Edit price", "addedit:price").row()
    .text("✏️ Edit plan",  "addedit:plan").row()
    .text("✅ Save", "addsave").text("❌ Cancel", "addcancel");
}

// ── Main conversation ─────────────────────────────────────────────────────────

export async function addMemberConversation(
  conversation: Conv,
  ctx: Context
): Promise<void> {
  try {
    await _addMemberConversationBody(conversation, ctx);
  } catch (e) {
    if (e instanceof ConversationCancelled) return; // state already cleared by returning
    throw e; // re-throw real errors so they surface properly
  }
}

async function _addMemberConversationBody(
  conversation: Conv,
  ctx: Context
): Promise<void> {
  // Fetch gym once (cached across replays by conversation.external)
  const gym = await conversation.external((outerCtx) =>
    getGymByTelegramId(outerCtx.env.DB, String(outerCtx.from?.id ?? ""))
  );
  if (!gym) {
    await ctx.reply("Please send /start first to register your gym.");
    return;
  }

  // ── Initial questions (mutable — any field can be re-asked during edit) ──────
  let currentName   = await askName(conversation, ctx);
  let currentPhone  = await askPhone(conversation, ctx);
  let currentAmount = await askAmount(conversation, ctx, gym.default_plan_price);
  let currentPlan   = await askPlan(conversation, ctx);

  // Pin admission date once, before the confirm loop, so editing a field
  // doesn't drift the admission date.
  const admissionDate = today();

  // ── Confirm + per-field edit loop ─────────────────────────────────────────────
  while (true) {
    const expiryDate = addDays(admissionDate, currentPlan.days);

    await ctx.reply(
      buildConfirmText(currentName, currentPhone, currentAmount, currentPlan, admissionDate, expiryDate),
      { parse_mode: "HTML", reply_markup: buildConfirmKeyboard() }
    );

    const btn = await conversation.waitForCallbackQuery([
      "addedit:name", "addedit:phone", "addedit:price", "addedit:plan",
      "addsave", "addcancel",
    ]);
    await btn.answerCallbackQuery();

    // ── Cancel ──────────────────────────────────────────────────────────────────
    if (btn.callbackQuery.data === "addcancel") {
      await btn.editMessageText("❌ Cancelled.");
      await ctx.reply("Nothing saved.", { reply_markup: ownerKeyboard() });
      return;
    }

    // ── Save ────────────────────────────────────────────────────────────────────
    if (btn.callbackQuery.data === "addsave") {
      await btn.editMessageText("💾 Saving…");

      let memberId: number;
      try {
        memberId = await conversation.external((outerCtx) =>
          addMember(outerCtx.env.DB, {
            gymId:         gym.id,
            name:          currentName,
            phone:         currentPhone,
            amountPaid:    currentAmount,
            admissionDate,
            expiryDate,
          })
        );
      } catch (err) {
        console.error("[/add] DB batch failed:", err);
        await btn.editMessageText("Sorry, couldn't save. Try /add again.");
        await ctx.reply("Nothing saved.", { reply_markup: ownerKeyboard() });
        return;
      }

      const daysUntil = daysBetween(admissionDate, expiryDate);
      await btn.editMessageText("✅ Saved!");
      await ctx.reply(
        `✅ Added <b>${esc(currentName)}</b> (ID #${memberId}).\n` +
        `Expires <b>${formatDate(expiryDate)}</b> (${daysUntil} days from now).`,
        { parse_mode: "HTML", reply_markup: ownerKeyboard() }
      );
      return;
    }

    // ── Edit one field ───────────────────────────────────────────────────────────
    const field = btn.callbackQuery.data.split(":")[1]; // "name"|"phone"|"price"|"plan"
    await btn.editMessageText(`✏️ <i>Editing ${field}…</i>`, { parse_mode: "HTML" });

    switch (field) {
      case "name":
        currentName = await askName(
          conversation, ctx,
          "✏️ <b>New name?</b> (2–60 characters)"
        );
        break;

      case "phone": {
        const raw = await ask(
          conversation, ctx,
          "✏️ <b>New phone?</b> (10 digits, or 'skip' to remove)",
          validatePhone
        );
        currentPhone = raw.toLowerCase() === "skip" ? null : raw;
        break;
      }

      case "price":
        currentAmount = await askAmount(
          conversation, ctx, gym.default_plan_price,
          `✏️ <b>New amount paid (₹)?</b>\nSend a number, or <b>default</b> for ₹${gym.default_plan_price}.`
        );
        break;

      case "plan":
        currentPlan = await askPlan(
          conversation, ctx,
          "✏️ <b>New plan duration?</b>"
        );
        break;
    }
    // Loop back → the next iteration re-renders confirm with the updated value
  }
}
