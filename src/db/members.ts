import { today, addDays } from "../utils/dates";

export interface MemberRow {
  id: number;
  gym_id: number;
  name: string;
  phone: string | null;
  amount_paid: number;
  admission_date: string;
  expiry_date: string;
  status: string;
  created_at: string;
}

export interface AddMemberInput {
  gymId: number;
  name: string;
  phone: string | null;
  amountPaid: number;
  admissionDate: string;
  expiryDate: string;
}

/**
 * Atomically inserts a member row and the corresponding payment record.
 * Uses D1 batch (single transaction) so both succeed or neither does.
 * The payment row references the member via SQLite's last_insert_rowid(),
 * which is valid because both statements run on the same connection.
 *
 * Returns the new member's auto-increment ID.
 */
export async function addMember(
  db: D1Database,
  input: AddMemberInput
): Promise<number> {
  const [memberResult] = await db.batch([
    db
      .prepare(
        `INSERT INTO members
           (gym_id, name, phone, amount_paid, admission_date, expiry_date, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .bind(
        input.gymId,
        input.name,
        input.phone ?? null,
        input.amountPaid,
        input.admissionDate,
        input.expiryDate,
        input.admissionDate
      ),
    db
      .prepare(
        `INSERT INTO member_payments (member_id, amount, payment_date, covers_until)
         VALUES (last_insert_rowid(), ?, ?, ?)`
      )
      .bind(input.amountPaid, input.admissionDate, input.expiryDate),
  ]);
  return memberResult.meta.last_row_id as number;
}

/** Active members for this gym, sorted soonest-to-expire first. */
export async function listActiveMembers(
  db: D1Database,
  gymId: number,
  limit: number,
  offset: number
): Promise<MemberRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, phone, expiry_date
       FROM members
       WHERE gym_id = ? AND status = 'active'
       ORDER BY expiry_date ASC
       LIMIT ? OFFSET ?`
    )
    .bind(gymId, limit, offset)
    .all<MemberRow>();
  return results;
}

export async function countActiveMembers(
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

/**
 * Members expiring within the next `withinDays` days (inclusive of today),
 * PLUS members already expired but still status='active' (in grace period).
 * Essentially: expiry_date <= today + withinDays.
 */
export async function listExpiringMembers(
  db: D1Database,
  gymId: number,
  withinDays: number,
  limit: number,
  offset: number
): Promise<MemberRow[]> {
  const cutoff = addDays(today(), withinDays);
  const { results } = await db
    .prepare(
      `SELECT id, name, phone, expiry_date
       FROM members
       WHERE gym_id = ? AND status = 'active' AND expiry_date <= ?
       ORDER BY expiry_date ASC
       LIMIT ? OFFSET ?`
    )
    .bind(gymId, cutoff, limit, offset)
    .all<MemberRow>();
  return results;
}

export async function countExpiringMembers(
  db: D1Database,
  gymId: number,
  withinDays: number
): Promise<number> {
  const cutoff = addDays(today(), withinDays);
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM members
       WHERE gym_id = ? AND status = 'active' AND expiry_date <= ?`
    )
    .bind(gymId, cutoff)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

/**
 * Fetches a single member by ID, scoped to the gym.
 * Always include gymId to prevent cross-gym data access.
 */
export async function getMember(
  db: D1Database,
  memberId: number,
  gymId: number
): Promise<MemberRow | null> {
  return db
    .prepare(`SELECT * FROM members WHERE id = ? AND gym_id = ? LIMIT 1`)
    .bind(memberId, gymId)
    .first<MemberRow>();
}

/**
 * Marks a member as 'expired' (was active, now past their expiry date but still
 * within the grace window). Only updates if current status is 'active' so the
 * call is idempotent.
 * Returns true if a row was actually updated.
 */
export async function expireMember(
  db: D1Database,
  memberId: number,
  gymId: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE members SET status = 'expired'
       WHERE id = ? AND gym_id = ? AND status = 'active'`
    )
    .bind(memberId, gymId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Marks a member as 'terminated' (past the grace window — auto-terminated by cron).
 * Guards on status IN ('active','expired') to prevent double-terminating and to
 * never overwrite 'cancelled'.
 * Returns true if a row was actually updated.
 */
export async function terminateMember(
  db: D1Database,
  memberId: number,
  gymId: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE members SET status = 'terminated'
       WHERE id = ? AND gym_id = ? AND status IN ('active', 'expired')`
    )
    .bind(memberId, gymId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Renews a member atomically via D1 batch (single transaction):
 *   1. UPDATE members: new expiry, status='active', amount_paid
 *   2. INSERT member_payments: renewal record
 *
 * Returns true if the member row was actually updated (i.e. it still existed
 * and belonged to the gym).
 */
export async function renewMemberInDb(
  db: D1Database,
  memberId: number,
  gymId: number,
  amountPaid: number,
  newExpiryDate: string,
  paymentDate: string
): Promise<boolean> {
  const [updateResult] = await db.batch([
    db
      .prepare(
        `UPDATE members
         SET expiry_date = ?, status = 'active', amount_paid = ?
         WHERE id = ? AND gym_id = ?`
      )
      .bind(newExpiryDate, amountPaid, memberId, gymId),
    db
      .prepare(
        `INSERT INTO member_payments (member_id, amount, payment_date, covers_until)
         VALUES (?, ?, ?, ?)`
      )
      .bind(memberId, amountPaid, paymentDate, newExpiryDate),
  ]);
  return (updateResult.meta.changes ?? 0) > 0;
}

/**
 * Cancels a member. The AND status='active' guard prevents double-cancelling.
 * Returns true if a row was actually updated.
 */
export async function cancelMember(
  db: D1Database,
  memberId: number,
  gymId: number
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE members
       SET status = 'cancelled'
       WHERE id = ? AND gym_id = ? AND status = 'active'`
    )
    .bind(memberId, gymId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
