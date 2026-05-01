/**
 * DB helpers for the developer billing system (Phase 5).
 *
 * Tables used:
 *   developer_payments          — one row per monthly bill per gym
 *   billing_notifications_sent  — dedup for billing reminder messages
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Bill {
  id:                      number;
  gym_id:                  number;
  amount:                  number;
  member_count_at_billing: number;
  billing_month:           string;   // 'YYYY-MM'
  paid_date:               string | null;
  status:                  "pending" | "paid";
}

export type BillStatus = "free_trial" | "paid" | "pending" | "none";

export interface GymBillingSummary {
  id:            number;
  gym_name:      string;
  owner_name:    string;
  is_active:     number;
  trial_ends_on: string | null;
  member_count:  number;
  bill_status:   BillStatus;
  bill_amount:   number | null;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Most recent pending (unpaid) bill for a gym, or null. */
export async function getPendingBill(
  db: D1Database,
  gymId: number
): Promise<Bill | null> {
  return db
    .prepare(
      `SELECT * FROM developer_payments
       WHERE gym_id = ? AND status = 'pending'
       ORDER BY billing_month DESC LIMIT 1`
    )
    .bind(gymId)
    .first<Bill>();
}

/**
 * All active gyms (is_active = 1) that have an unpaid pending bill for
 * the given billing month — used by the daily billing-reminder cron.
 */
export async function getGymsPendingBills(
  db: D1Database,
  billingMonth: string
): Promise<Array<{
  gym_id:            number;
  telegram_user_id:  string;
  gym_name:          string;
  amount:            number;
  billing_month:     string;
}>> {
  const { results } = await db
    .prepare(
      `SELECT g.id          AS gym_id,
              g.telegram_user_id,
              g.gym_name,
              dp.amount,
              dp.billing_month
       FROM gyms g
       JOIN developer_payments dp ON dp.gym_id = g.id
       WHERE g.is_active   = 1
         AND dp.status      = 'pending'
         AND dp.paid_date   IS NULL
         AND dp.billing_month = ?`
    )
    .bind(billingMonth)
    .all<{
      gym_id:           number;
      telegram_user_id: string;
      gym_name:         string;
      amount:           number;
      billing_month:    string;
    }>();
  return results;
}

/** Insert a new pending bill and update last_billed_month atomically. */
export async function createBillAndMarkMonth(
  db: D1Database,
  gymId:        number,
  amount:       number,
  memberCount:  number,
  billingMonth: string
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO developer_payments
           (gym_id, amount, member_count_at_billing, billing_month, status)
         VALUES (?, ?, ?, ?, 'pending')`
      )
      .bind(gymId, amount, memberCount, billingMonth),
    db
      .prepare(`UPDATE gyms SET last_billed_month = ? WHERE id = ?`)
      .bind(billingMonth, gymId),
  ]);
}

/**
 * Mark a pending bill as paid and ensure the gym is active.
 * Returns true if a bill row was actually updated.
 */
export async function markBillPaid(
  db: D1Database,
  gymId:        number,
  billingMonth: string,
  paidDate:     string
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE developer_payments
         SET status = 'paid', paid_date = ?
         WHERE gym_id = ? AND billing_month = ? AND status = 'pending'`
      )
      .bind(paidDate, gymId, billingMonth),
    db
      .prepare(`UPDATE gyms SET is_active = 1 WHERE id = ?`)
      .bind(gymId),
  ]);
  return (results[0].meta.changes ?? 0) > 0;
}

/** Total paid revenue for a billing month, plus per-gym breakdown. */
export async function getRevenueForMonth(
  db: D1Database,
  billingMonth: string
): Promise<{
  total:     number;
  breakdown: Array<{ gym_name: string; amount: number }>;
}> {
  const [totRow, breakdownRes] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE(SUM(dp.amount), 0) AS total
         FROM developer_payments dp
         WHERE dp.billing_month = ? AND dp.status = 'paid'`
      )
      .bind(billingMonth),
    db
      .prepare(
        `SELECT g.gym_name, dp.amount
         FROM developer_payments dp
         JOIN gyms g ON g.id = dp.gym_id
         WHERE dp.billing_month = ? AND dp.status = 'paid'
         ORDER BY dp.amount DESC`
      )
      .bind(billingMonth),
  ]);

  const total     = (totRow.results[0] as { total: number } | undefined)?.total ?? 0;
  const breakdown = breakdownRes.results as Array<{ gym_name: string; amount: number }>;
  return { total, breakdown };
}

/** All gyms with their member count and current-month bill status. */
export async function getGymBillingSummaries(
  db: D1Database,
  billingMonth: string,
  todayStr: string
): Promise<GymBillingSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT
         g.id,
         g.gym_name,
         g.owner_name,
         g.is_active,
         g.trial_ends_on,
         (SELECT COUNT(*) FROM members m
          WHERE m.gym_id = g.id AND m.status = 'active') AS member_count,
         dp.status  AS dp_status,
         dp.amount  AS dp_amount
       FROM gyms g
       LEFT JOIN developer_payments dp
         ON dp.gym_id = g.id AND dp.billing_month = ?
       ORDER BY g.id ASC`
    )
    .bind(billingMonth)
    .all<{
      id:            number;
      gym_name:      string;
      owner_name:    string;
      is_active:     number;
      trial_ends_on: string | null;
      member_count:  number;
      dp_status:     string | null;
      dp_amount:     number | null;
    }>();

  return results.map((r) => {
    let bill_status: BillStatus;
    if (r.dp_status === "paid")    bill_status = "paid";
    else if (r.dp_status === "pending") bill_status = "pending";
    else if (r.trial_ends_on && r.trial_ends_on > todayStr) bill_status = "free_trial";
    else bill_status = "none"; // no members or billing gap

    return {
      id:            r.id,
      gym_name:      r.gym_name,
      owner_name:    r.owner_name,
      is_active:     r.is_active,
      trial_ends_on: r.trial_ends_on,
      member_count:  r.member_count,
      bill_status,
      bill_amount:   r.dp_amount,
    };
  });
}

/** Count of active members for a gym — used during billing to compute charge. */
export async function countActiveMembersForGym(
  db: D1Database,
  gymId: number
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM members WHERE gym_id = ? AND status = 'active'`
    )
    .bind(gymId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/** Returns true if this billing reminder was already dispatched this month. */
export async function wasBillingReminderSent(
  db: D1Database,
  gymId:        number,
  billingMonth: string,
  notifType:    string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM billing_notifications_sent
       WHERE gym_id = ? AND billing_month = ? AND notification_type = ?`
    )
    .bind(gymId, billingMonth, notifType)
    .first<{ cnt: number }>();
  return (row?.cnt ?? 0) > 0;
}

/** Record that a billing reminder was dispatched. */
export async function recordBillingReminder(
  db: D1Database,
  gymId:        number,
  billingMonth: string,
  notifType:    string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO billing_notifications_sent (gym_id, billing_month, notification_type)
       VALUES (?, ?, ?)`
    )
    .bind(gymId, billingMonth, notifType)
    .run();
}
