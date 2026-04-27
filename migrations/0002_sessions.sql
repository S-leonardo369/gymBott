-- Stores conversation state for the grammY conversations plugin.
-- Key = chatId (from ctx.chatId), value = JSON-serialised VersionedState.
CREATE TABLE IF NOT EXISTS sessions (
  key        TEXT NOT NULL PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
