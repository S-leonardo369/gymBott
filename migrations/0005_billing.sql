-- Add billing fields to gyms table
ALTER TABLE gyms ADD COLUMN trial_ends_on    TEXT;
ALTER TABLE gyms ADD COLUMN last_billed_month TEXT;

-- Backfill trial_ends_on for existing gyms based on their registration date.
-- New gyms have trial_ends_on set explicitly by the onboarding conversation.
UPDATE gyms
   SET trial_ends_on = date(created_at, '+60 days')
 WHERE trial_ends_on IS NULL;

-- Separate dedup table for billing reminders.
-- Cannot reuse notifications_sent (which requires a member_id FK).
CREATE TABLE IF NOT EXISTS billing_notifications_sent (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  gym_id            INTEGER NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  billing_month     TEXT    NOT NULL,   -- 'YYYY-MM'
  notification_type TEXT    NOT NULL,   -- 'bill_reminder_5', '_10', '_15'
  sent_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_notif
  ON billing_notifications_sent(gym_id, billing_month, notification_type);
