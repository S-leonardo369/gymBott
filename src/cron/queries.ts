/**
 * SQL query for fetching members the cron needs to act on today.
 *
 * Categories (computed from today's date vs expiry_date):
 *
 *   A  — expiry_date = today + 3  → 3-day warning (actionable)
 *   A2 — expiry_date = today + 2  → 2-day FYI     (no action buttons)
 *   A1 — expiry_date = today + 1  → 1-day FYI     (no action buttons)
 *   B  — expiry_date = today       → expires today (actionable)
 *   C  — expiry_date < today
 *          AND expiry_date >= graceCutoff → in grace (actionable)
 *   D  — expiry_date < graceCutoff → past grace, auto-terminate
 *
 * Date params are pre-computed in TypeScript (not via SQLite date modifiers)
 * so the function is easy to test with any override date.
 */

import { addDays } from "../utils/dates";

export interface MemberCronRow {
  id:             number;
  name:           string;
  phone:          string | null;
  status:         string;                         // 'active' | 'expired'
  expiry_date:    string;                         // YYYY-MM-DD
  admission_date: string;                         // YYYY-MM-DD
  category:       "A" | "A2" | "A1" | "B" | "C" | "D";
}

/**
 * Returns all members the cron should process today for `gymId`.
 *
 * @param db              - D1 database binding
 * @param gymId           - gym to scope the query
 * @param gracePeriodDays - from gym.grace_period_days
 * @param todayStr        - YYYY-MM-DD; pass an override date for testing
 */
export async function getMembersForCron(
  db: D1Database,
  gymId: number,
  gracePeriodDays: number,
  todayStr: string
): Promise<MemberCronRow[]> {
  // Pre-compute all boundary dates in TypeScript
  const threeDaysOut = addDays(todayStr, 3);               // Cat A
  const twoDaysOut   = addDays(todayStr, 2);               // Cat A2
  const oneDayOut    = addDays(todayStr, 1);               // Cat A1
  // todayStr itself                                        // Cat B
  const graceCutoff  = addDays(todayStr, -gracePeriodDays); // C/D boundary

  /*
   * CASE WHEN order matters — SQLite picks the FIRST matching branch:
   *   1. expiry = today+3  → A
   *   2. expiry = today+2  → A2
   *   3. expiry = today+1  → A1
   *   4. expiry = today    → B
   *   5. expiry >= graceCutoff → C  (expiry < today implied by WHERE)
   *   ELSE                    → D
   *
   * WHERE limits rows to only the dates we act on:
   *   - expiry = today+3 / today+2 / today+1  (cats A / A2 / A1)
   *   - expiry <= today                        (cats B / C / D)
   */
  const sql = `
    SELECT
      m.id,
      m.name,
      m.phone,
      m.status,
      m.expiry_date,
      m.admission_date,
      CASE
        WHEN m.expiry_date  = ?  THEN 'A'
        WHEN m.expiry_date  = ?  THEN 'A2'
        WHEN m.expiry_date  = ?  THEN 'A1'
        WHEN m.expiry_date  = ?  THEN 'B'
        WHEN m.expiry_date >= ?  THEN 'C'
        ELSE                          'D'
      END AS category
    FROM members m
    WHERE m.gym_id = ?
      AND m.status IN ('active', 'expired')
      AND (
        m.expiry_date = ?       -- Cat A:  today+3
        OR m.expiry_date = ?    -- Cat A2: today+2
        OR m.expiry_date = ?    -- Cat A1: today+1
        OR m.expiry_date <= ?   -- Cat B/C/D: today or past
      )
    ORDER BY m.expiry_date ASC
  `;

  const { results } = await db
    .prepare(sql)
    .bind(
      // CASE WHEN branches (5 params)
      threeDaysOut,  // branch 1 → A
      twoDaysOut,    // branch 2 → A2
      oneDayOut,     // branch 3 → A1
      todayStr,      // branch 4 → B
      graceCutoff,   // branch 5 → C (>= graceCutoff)
      // WHERE clause (5 params)
      gymId,         // gym scope
      threeDaysOut,  // OR expiry = today+3
      twoDaysOut,    // OR expiry = today+2
      oneDayOut,     // OR expiry = today+1
      todayStr       // OR expiry <= today
    )
    .all<MemberCronRow>();

  return results;
}
