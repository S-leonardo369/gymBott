-- gyms: one row per registered gym owner
CREATE TABLE IF NOT EXISTS gyms (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id    TEXT    NOT NULL UNIQUE,
  gym_name            TEXT    NOT NULL,
  owner_name          TEXT    NOT NULL,
  owner_phone         TEXT    NOT NULL,
  grace_period_days   INTEGER NOT NULL DEFAULT 4,
  default_plan_price  INTEGER NOT NULL,           -- in rupees
  is_active           INTEGER NOT NULL DEFAULT 1,
  dev_paid_until      TEXT,                       -- ISO date, NULL until first payment
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- members: gym members whose expiry dates are tracked
CREATE TABLE IF NOT EXISTS members (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  gym_id          INTEGER NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  phone           TEXT    NOT NULL,
  amount_paid     INTEGER NOT NULL,               -- in rupees
  admission_date  TEXT    NOT NULL,               -- ISO date
  expiry_date     TEXT    NOT NULL,               -- ISO date
  status          TEXT    NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'terminated', 'cancelled')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- member_payments: renewal history per member
CREATE TABLE IF NOT EXISTS member_payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount        INTEGER NOT NULL,                 -- in rupees
  payment_date  TEXT    NOT NULL,                 -- ISO date
  covers_until  TEXT    NOT NULL                  -- ISO date
);

-- developer_payments: monthly SaaS billing records
CREATE TABLE IF NOT EXISTS developer_payments (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  gym_id                  INTEGER NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  amount                  INTEGER NOT NULL,       -- in rupees
  member_count_at_billing INTEGER NOT NULL,
  billing_month           TEXT    NOT NULL,       -- 'YYYY-MM'
  paid_date               TEXT,                   -- ISO date, NULL until paid
  status                  TEXT    NOT NULL DEFAULT 'pending'
);

-- notifications_sent: dedup guard so reminders are never sent twice
CREATE TABLE IF NOT EXISTS notifications_sent (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id         INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  notification_type TEXT    NOT NULL,
  sent_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_members_gym_status   ON members(gym_id, status);
CREATE INDEX IF NOT EXISTS idx_members_expiry        ON members(expiry_date);
CREATE INDEX IF NOT EXISTS idx_gyms_telegram_user    ON gyms(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_member  ON notifications_sent(member_id, notification_type);
