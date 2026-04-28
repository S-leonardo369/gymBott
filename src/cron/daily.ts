/**
 * Daily cron logic — runs at 03:30 UTC (09:00 IST) via the "30 3 * * *" trigger.
 *
 * Entry point: runDailyCron(env, overrideDate?)
 *
 * For each active gym, getMembersForCron() returns members categorised as:
 *   A  → 3-day warning (with action buttons)
 *   A2 → 2-day FYI     (no buttons — quieter heads-up)
 *   A1 → 1-day FYI     (no buttons — quieter heads-up)
 *   B  → expires today (with action buttons)
 *   C  → in grace period (with action buttons)
 *   D  → past grace → auto-terminate
 *
 * Safety guarantees:
 *   - Every gym is wrapped in its own try/catch: one gym failure never stops others.
 *   - Every per-member status change is logged: [STATE] member N: old -> new.
 *   - Notifications are only recorded AFTER a successful Telegram send.
 *   - Termination guards on AND status IN ('active','expired') — can't overwrite
 *     'cancelled'.
 *   - Dedup: skip if wasNotifiedRecently() within 20 hours.
 *
 * nowOverride threading (Issue 1 fix):
 *   When overrideDate is supplied (e.g. from /admin_run_cron), we derive
 *   nowOverride = "<overrideDate> 09:00:00" and pass it down to both
 *   wasNotifiedRecently() and recordNotification() so that dedup comparisons
 *   are made against the simulated time, not wall-clock time.
 *   Production cron (overrideDate = undefined) leaves nowOverride undefined,
 *   so both functions fall back to datetime('now') — no change in production.
 */

import type { Env } from "../index";
import type { Gym } from "../db/gyms";
import { getAllActiveGyms } from "../db/gyms";
import { expireMember, terminateMember } from "../db/members";
import { wasNotifiedRecently, recordNotification } from "../db/notifications";
import { getMembersForCron, type MemberCronRow } from "./queries";
import { sendMessage } from "../utils/telegram";
import { today, addDays, formatDate, daysBetween } from "../utils/dates";
import { esc } from "../utils/format";

// ── Public result type ────────────────────────────────────────────────────────

export interface DailyCronResult {
  date:               string;
  gymsProcessed:      number;
  notificationsSent:  number;
  autoTerminations:   number;
  errors:             number;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Runs the full daily cron for all active gyms.
 *
 * @param env          - Cloudflare Worker env bindings
 * @param overrideDate - YYYY-MM-DD; when set, used as "today" instead of real
 *                       UTC date.  Also drives nowOverride for dedup so that
 *                       simulated "next-day" tests actually bypass dedup.
 */
export async function runDailyCron(
  env: Env,
  overrideDate?: string
): Promise<DailyCronResult> {
  const dateStr = overrideDate ?? today();

  // Derive a simulated "now" for dedup when testing with an override date.
  // Using 09:00:00 matches the cron's actual fire time (03:30 UTC = 09:00 IST)
  // and ensures that two back-to-back override runs on the same simulated date
  // still dedup correctly, while a run on the next simulated date clears dedup.
  const nowOverride = overrideDate ? `${overrideDate} 09:00:00` : undefined;

  const result: DailyCronResult = {
    date:              dateStr,
    gymsProcessed:     0,
    notificationsSent: 0,
    autoTerminations:  0,
    errors:            0,
  };

  let gyms: Gym[];
  try {
    gyms = await getAllActiveGyms(env.DB);
  } catch (err) {
    console.error("[cron] Failed to fetch gyms:", err);
    result.errors++;
    return result;
  }

  for (const gym of gyms) {
    try {
      const stats = await processGym(env, gym, dateStr, nowOverride);
      result.gymsProcessed++;
      result.notificationsSent += stats.notificationsSent;
      result.autoTerminations  += stats.autoTerminations;
    } catch (err) {
      console.error(`[cron] Unhandled error for gym ${gym.id} (${gym.gym_name}):`, err);
      result.errors++;
      // Continue to next gym — one failure must not block others
    }
  }

  console.log(`[cron] Finished for ${dateStr}:`, JSON.stringify(result));
  return result;
}

// ── Per-gym processing ────────────────────────────────────────────────────────

interface GymStats {
  notificationsSent: number;
  autoTerminations:  number;
}

async function processGym(
  env: Env,
  gym: Gym,
  dateStr: string,
  nowOverride: string | undefined
): Promise<GymStats> {
  const stats: GymStats = { notificationsSent: 0, autoTerminations: 0 };

  const members = await getMembersForCron(
    env.DB,
    gym.id,
    gym.grace_period_days,
    dateStr
  );

  for (const member of members) {
    try {
      if (member.category === "D") {
        await handleTermination(env, gym, member, nowOverride, stats);
      } else {
        await handleNotification(env, gym, member, dateStr, nowOverride, stats);
      }
    } catch (err) {
      // Per-member errors are logged but don't fail the whole gym
      console.error(
        `[cron] Error on member ${member.id} (${member.name}) gym ${gym.id}:`,
        err
      );
    }
  }

  return stats;
}

// ── Category D: auto-termination ──────────────────────────────────────────────

async function handleTermination(
  env: Env,
  gym: Gym,
  member: MemberCronRow,
  nowOverride: string | undefined,
  stats: GymStats
): Promise<void> {
  const oldStatus = member.status;

  // Guard: already in a terminal state — nothing to do
  if (oldStatus === "terminated" || oldStatus === "cancelled") return;

  // UPDATE — terminateMember guards with AND status IN ('active','expired')
  const changed = await terminateMember(env.DB, member.id, gym.id);
  if (!changed) {
    // Row reached a terminal state between our SELECT and this UPDATE
    return;
  }

  console.log(`[STATE] member ${member.id}: ${oldStatus} -> terminated`);
  stats.autoTerminations++;

  // Notify owner — no action buttons, member is already terminated
  const text =
    `❌ <b>${esc(member.name)}</b> auto-terminated — didn't renew within the grace period.\n\n` +
    `📅 Member from <b>${formatDate(member.admission_date)}</b> to <b>${formatDate(member.expiry_date)}</b>.\n` +
    `Use /add to re-add if they pay later.`;

  const sent = await sendMessage(env.BOT_TOKEN, gym.telegram_user_id, text);
  if (!sent) {
    console.error(
      `[cron] Failed to send termination notice for member ${member.id} to gym ${gym.id}`
    );
    // Record the notification anyway — the state change happened even if the
    // message didn't land, so we don't want the next cron run to try again.
  }

  await recordNotification(env.DB, member.id, gym.id, "terminated", nowOverride);
  if (sent) stats.notificationsSent++;
}

// ── Categories A / A2 / A1 / B / C: owner notifications ──────────────────────

async function handleNotification(
  env: Env,
  gym: Gym,
  member: MemberCronRow,
  dateStr: string,
  nowOverride: string | undefined,
  stats: GymStats
): Promise<void> {
  const { category } = member;

  // Map category to a unique notification_type string for dedup
  const notifType: string =
    category === "A"  ? "warning_3d"    :
    category === "A2" ? "fyi_2d"        :
    category === "A1" ? "fyi_1d"        :
    category === "B"  ? "warning_today" :
                        "grace_warning"; // C

  // ── Dedup: skip if already notified within 20 hours ────────────────────────
  const alreadySent = await wasNotifiedRecently(
    env.DB, member.id, notifType, 20, nowOverride
  );
  if (alreadySent) return;

  // ── Update status: active → expired (categories C only) ────────────────────
  // A/A2/A1/B: not expired yet — don't change status.
  // C: expiry_date < dateStr, so they are now expired.
  if (category === "C" && member.status === "active") {
    const changed = await expireMember(env.DB, member.id, gym.id);
    if (changed) {
      console.log(`[STATE] member ${member.id}: active -> expired`);
    }
  }

  // ── Build notification text ─────────────────────────────────────────────────
  // category is guaranteed non-D here (handleNotification is never called for D)
  const text = buildNotificationText(
    member, gym.grace_period_days, dateStr, category as ActionableCategory
  );

  // ── Keyboard: action buttons only for A / B / C; FYI categories get none ───
  const needsButtons = category === "A" || category === "B" || category === "C";
  const keyboard = needsButtons
    ? [[
        { text: "✅ Renewed",  callback_data: `renew:${member.id}`        },
        { text: "⏭ Not yet",  callback_data: `notyet:${member.id}`       },
        { text: "❌ Cancel",   callback_data: `cancelmember:${member.id}` },
      ]]
    : undefined;

  const sent = await sendMessage(
    env.BOT_TOKEN, gym.telegram_user_id, text, { keyboard }
  );

  if (!sent) {
    console.error(
      `[cron] Failed to send ${notifType} for member ${member.id} to gym ${gym.id}`
    );
    // Don't record — next cron run should retry
    return;
  }

  await recordNotification(env.DB, member.id, gym.id, notifType, nowOverride);
  stats.notificationsSent++;
}

// ── Notification text builders ────────────────────────────────────────────────

type ActionableCategory = "A" | "A2" | "A1" | "B" | "C";

function buildNotificationText(
  member: MemberCronRow,
  gracePeriodDays: number,
  dateStr: string,
  category: ActionableCategory
): string {
  const name    = esc(member.name);
  const expDate = formatDate(member.expiry_date);

  switch (category) {
    case "A":
      return (
        `⚠️ <b>${name}</b>'s membership expires in 3 days ` +
        `(<b>${expDate}</b>).\n\nDid they renew?`
      );

    case "A2":
      return (
        `📍 <b>${name}</b> expires in 2 days (<b>${expDate}</b>). ` +
        `FYI — we'll prompt for action on expiry day.`
      );

    case "A1":
      return (
        `📍 <b>${name}</b> expires <b>tomorrow</b> (<b>${expDate}</b>). ` +
        `FYI — we'll prompt for action on expiry day.`
      );

    case "B":
      return (
        `🔔 <b>${name}</b>'s membership expires <b>TODAY</b> ` +
        `(${expDate}).\n\nDid they renew?`
      );

    case "C": {
      const graceEnd = addDays(member.expiry_date, gracePeriodDays);
      const daysLeft = daysBetween(dateStr, graceEnd);
      const dayWord  = daysLeft === 1 ? "day" : "days";
      return (
        `🔴 <b>${name}</b> is past expiry.\n` +
        `Grace ends <b>${formatDate(graceEnd)}</b> — ` +
        `<b>${daysLeft} ${dayWord} left</b>.\n\n` +
        `Auto-terminate on grace end if not renewed.`
      );
    }
  }
}
