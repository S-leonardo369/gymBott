-- notifications_sent was created without a gym_id column.
-- Adding it now so we can query/clean-up notifications by gym directly.
-- SQLite supports ADD COLUMN as long as the column has no unique constraint
-- and accepts NULL (or has a default) — both are true here.

ALTER TABLE notifications_sent
  ADD COLUMN gym_id INTEGER REFERENCES gyms(id) ON DELETE CASCADE;

-- Optional index for gym-level queries (e.g. "all notifications for gym X")
CREATE INDEX IF NOT EXISTS idx_notifications_gym
  ON notifications_sent(gym_id, notification_type);
