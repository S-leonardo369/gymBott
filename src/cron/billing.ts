/**
 * Monthly billing cron — runs on the 1st of each month at 04:00 UTC
 * (wrangler.jsonc: "0 4 1 * *").
 *
 * Logic per active gym:
 *   1. Skip if still in free trial (trial_ends_on > today)
 *   2. Skip if already billed this month (last_billed_month == YYYY-MM)
 *   3. Skip if 0 active members
 *   4. Charge ₹20 × member_count, insert pending bill, notify owner
 */

import type { Env } from "../index";
import { getAllActiveGyms } from "../db/gyms";
import { countActiveMembersForGym, createBillAndMarkMonth } from "../db/billing";
import { sendMessage } from "../utils/telegram";
import { today } from "../utils/dates";
import { esc } from "../utils/format";

// ── Message builder ───────────────────────────────────────────────────────────

function buildBillingMessage(
  gymName:     string,
  memberCount: number,
  amount:      number,
  month:       string,
  upiId:       string
): string {
  const upiLink = upiId
    ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=JK%20Stack&am=${amount}&cu=INR`
    : "";

  return (
    `💳 <b>Monthly bill for ${esc(gymName)}</b>\n` +
    `📅 Billing month: <b>${month}</b>\n\n` +
    `👤 Active members: <b>${memberCount}</b>\n` +
    `💰 Amount due: <b>₹${amount}</b>\n\n` +
    (upiId
      ? `Pay via UPI to: <b>${esc(upiId)}</b>\n` +
        `UPI link: <code>${upiLink}</code>\n\n`
      : "") +
    `⚠️ Service pauses on day 15 if unpaid.\n` +
    `⏰ Data is preserved either way.\n\n` +
    `Reply with /paid once you've sent the payment.\n` +
    `Need help? Send /feedback.`
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function runMonthlyBilling(env: Env): Promise<void> {
  const dateStr     = today();
  const billingMonth = dateStr.slice(0, 7); // 'YYYY-MM'
  const upiId       = env.DEVELOPER_UPI_ID ?? "";

  let gyms;
  try {
    gyms = await getAllActiveGyms(env.DB);
  } catch (err) {
    console.error("[billing] Failed to fetch gyms:", err);
    return;
  }

  let billed  = 0;
  let skipped = 0;

  for (const gym of gyms) {
    try {
      // 1. Still in free trial?
      if (gym.trial_ends_on && dateStr < gym.trial_ends_on) {
        skipped++;
        continue;
      }

      // 2. Already billed this month?
      if (gym.last_billed_month === billingMonth) {
        skipped++;
        continue;
      }

      // 3. Count active members
      const memberCount = await countActiveMembersForGym(env.DB, gym.id);

      // 4. No members — no charge
      if (memberCount === 0) {
        skipped++;
        continue;
      }

      // 5. Create bill + stamp last_billed_month atomically
      const amount = memberCount * 20;
      await createBillAndMarkMonth(env.DB, gym.id, amount, memberCount, billingMonth);

      // 6. Notify owner
      const sent = await sendMessage(
        env.BOT_TOKEN,
        gym.telegram_user_id,
        buildBillingMessage(gym.gym_name, memberCount, amount, billingMonth, upiId)
      );

      if (!sent) {
        console.error(`[billing] Failed to send bill to gym ${gym.id} (${gym.gym_name})`);
      }

      console.log(
        `[billing] Billed gym ${gym.id} (${gym.gym_name}): ` +
        `₹${amount} (${memberCount} members) for ${billingMonth}`
      );
      billed++;
    } catch (err) {
      console.error(`[billing] Error for gym ${gym.id} (${gym.gym_name}):`, err);
    }
  }

  console.log(
    `[billing] Done for ${billingMonth}: billed=${billed}, skipped=${skipped}`
  );
}
