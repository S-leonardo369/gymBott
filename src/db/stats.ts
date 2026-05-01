/**
 * Stats queries for /stats command.
 * All queries are scoped to a single gym_id.
 * Uses db.batch() so all queries run in one round-trip.
 */

import { addDays, today } from "../utils/dates";

export interface GymStats {
  activeCount:          number;
  newThisMonth:         number;
  totalCancelled:       number;
  terminatedThisMonth:  number;
  revenueThisMonth:     number;
  revenueLastMonth:     number;
  expiringIn7Days:      number;
}

/** Returns YYYY-MM-DD for the first day of the given month offset from now. */
function firstOfMonth(monthOffset: number): string {
  const d = new Date();
  // Use UTC so the Worker's timezone (always UTC) is consistent
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth() + monthOffset; // JS handles overflow/underflow
  const first = new Date(Date.UTC(year, month, 1));
  return first.toISOString().slice(0, 10);
}

/** Returns YYYY-MM-DD for the last day of the given month offset from now. */
function lastOfMonth(monthOffset: number): string {
  const d = new Date();
  const year  = d.getUTCFullYear();
  const month = d.getUTCMonth() + monthOffset;
  // Day 0 of next month = last day of target month
  const last  = new Date(Date.UTC(year, month + 1, 0));
  return last.toISOString().slice(0, 10);
}

export async function getGymStats(
  db: D1Database,
  gymId: number
): Promise<GymStats> {
  const thisFirst = firstOfMonth(0);
  const thisLast  = lastOfMonth(0);
  const lastFirst = firstOfMonth(-1);
  const lastLast  = lastOfMonth(-1);
  const cutoff7   = addDays(today(), 7);

  const [
    activeRes,
    newRes,
    cancelledRes,
    terminatedRes,
    revThisRes,
    revLastRes,
    expiringRes,
  ] = await db.batch([
    // 1. Active count
    db.prepare(
      `SELECT COUNT(*) AS cnt FROM members WHERE gym_id = ? AND status = 'active'`
    ).bind(gymId),

    // 2. New this month (by admission_date)
    db.prepare(
      `SELECT COUNT(*) AS cnt FROM members WHERE gym_id = ? AND admission_date >= ?`
    ).bind(gymId, thisFirst),

    // 3. Total cancelled all-time
    db.prepare(
      `SELECT COUNT(*) AS cnt FROM members WHERE gym_id = ? AND status = 'cancelled'`
    ).bind(gymId),

    // 4. Auto-terminated this month (via notifications_sent log)
    db.prepare(
      `SELECT COUNT(*) AS cnt
       FROM notifications_sent
       WHERE gym_id = ? AND notification_type = 'terminated' AND sent_at >= ?`
    ).bind(gymId, thisFirst),

    // 5. Revenue this month
    db.prepare(
      `SELECT COALESCE(SUM(mp.amount), 0) AS total
       FROM member_payments mp
       JOIN members m ON m.id = mp.member_id
       WHERE m.gym_id = ? AND mp.payment_date >= ? AND mp.payment_date <= ?`
    ).bind(gymId, thisFirst, thisLast),

    // 6. Revenue last month
    db.prepare(
      `SELECT COALESCE(SUM(mp.amount), 0) AS total
       FROM member_payments mp
       JOIN members m ON m.id = mp.member_id
       WHERE m.gym_id = ? AND mp.payment_date >= ? AND mp.payment_date <= ?`
    ).bind(gymId, lastFirst, lastLast),

    // 7. Expiring in next 7 days (expiry_date <= today+7, still active)
    db.prepare(
      `SELECT COUNT(*) AS cnt
       FROM members
       WHERE gym_id = ? AND status = 'active' AND expiry_date <= ?`
    ).bind(gymId, cutoff7),
  ]);

  return {
    activeCount:         (activeRes.results[0]     as any)?.cnt     ?? 0,
    newThisMonth:        (newRes.results[0]         as any)?.cnt     ?? 0,
    totalCancelled:      (cancelledRes.results[0]   as any)?.cnt     ?? 0,
    terminatedThisMonth: (terminatedRes.results[0]  as any)?.cnt     ?? 0,
    revenueThisMonth:    (revThisRes.results[0]     as any)?.total   ?? 0,
    revenueLastMonth:    (revLastRes.results[0]     as any)?.total   ?? 0,
    expiringIn7Days:     (expiringRes.results[0]    as any)?.cnt     ?? 0,
  };
}
