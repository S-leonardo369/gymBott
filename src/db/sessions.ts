import type { VersionedState, VersionedStateStorage } from "@grammyjs/conversations";

/**
 * D1-backed storage adapter for the grammY conversations plugin.
 * Stores VersionedState<T> as JSON in the `sessions` table.
 */
export class D1StorageAdapter<T> implements VersionedStateStorage<string, T> {
  constructor(private readonly db: D1Database) {}

  async read(key: string): Promise<VersionedState<T> | undefined> {
    const row = await this.db
      .prepare("SELECT value FROM sessions WHERE key = ?")
      .bind(key)
      .first<{ value: string }>();
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as VersionedState<T>;
    } catch {
      return undefined;
    }
  }

  async write(key: string, state: VersionedState<T>): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sessions (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE
           SET value      = excluded.value,
               updated_at = datetime('now')`
      )
      .bind(key, JSON.stringify(state))
      .run();
  }

  async delete(key: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM sessions WHERE key = ?")
      .bind(key)
      .run();
  }
}
