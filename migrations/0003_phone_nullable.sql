-- members.phone was incorrectly defined as NOT NULL.
-- Phone is optional (user can skip it when adding a member).
-- SQLite can't ALTER COLUMN, so we recreate the table.

PRAGMA foreign_keys = OFF;

CREATE TABLE members_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  gym_id          INTEGER NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL,
  phone           TEXT,                           -- nullable: owner can skip
  amount_paid     INTEGER NOT NULL,
  admission_date  TEXT    NOT NULL,
  expiry_date     TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'expired', 'terminated', 'cancelled')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO members_new SELECT * FROM members;

DROP TABLE members;
ALTER TABLE members_new RENAME TO members;

-- Re-create indexes (dropped with the old table)
CREATE INDEX IF NOT EXISTS idx_members_gym_status ON members(gym_id, status);
CREATE INDEX IF NOT EXISTS idx_members_expiry      ON members(expiry_date);

PRAGMA foreign_keys = ON;
