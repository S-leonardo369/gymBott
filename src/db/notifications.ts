/**
 * Dedup guard for cron notifications.
 *
 * Both functions accept an optional `nowOverride` (ISO datetime string,
 * e.g. "2030-01-10 09:00:00").  When set, it replaces SQLite's datetime('now')
 * so that /admin_run_cron with a date override produces consistent dedup
 * behaviour — "next-day re-notify" tests work correctly even though the
 * wall-clock time hasn't moved.
 *
 * Production cron leaves nowOverride undefined and everything falls back to
 * datetime('now') — zero behaviour change in production.
 */

/**
 * Returns true if a notification of the given type was already sent for this
 * member within the last `withinHours` hours.
 *
 * @param nowOverride - when set, used as the reference "now" instead of
 *                      SQLite's datetime('now').  Format: "YYYY-MM-DD HH:MM:SS"
 */
export async function wasNotifiedRecently(
  db: D1Database,
  memberId: number,
  notificationType: string,
  withinHours: number = 20,
  nowOverride?: string
): Promise<boolean> {
  const modifier = `-${withinHours} hours`;

  let row: { cnt: number } | null;

  if (nowOverride) {
    // Compare against override time: sent_at >= datetime(<override>, '-20 hours')
    row = await db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM notifications_sent
         WHERE member_id         = ?
           AND notification_type = ?
           AND sent_at           >= datetime(?, ?)`
      )
      .bind(memberId, notificationType, nowOverride, modifier)
      .first<{ cnt: number }>();
  } else {
    row = await db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM notifications_sent
         WHERE member_id         = ?
           AND notification_type = ?
           AND sent_at           >= datetime('now', ?)`
      )
      .bind(memberId, notificationType, modifier)
      .first<{ cnt: number }>();
  }

  return (row?.cnt ?? 0) > 0;
}

/**
 * Records that a notification was sent for this member.
 * Call this only AFTER a successful Telegram API send.
 *
 * @param nowOverride - when set, written as sent_at instead of datetime('now').
 *                      Format: "YYYY-MM-DD HH:MM:SS"
 */
export async function recordNotification(
  db: D1Database,
  memberId: number,
  gymId: number,
  notificationType: string,
  nowOverride?: string
): Promise<void> {
  if (nowOverride) {
    await db
      .prepare(
        `INSERT INTO notifications_sent (member_id, gym_id, notification_type, sent_at)
         VALUES (?, ?, ?, datetime(?))`
      )
      .bind(memberId, gymId, notificationType, nowOverride)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO notifications_sent (member_id, gym_id, notification_type, sent_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .bind(memberId, gymId, notificationType)
      .run();
  }
}
