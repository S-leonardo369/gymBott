import type { Env } from "../index";

// R2-extended Env — only used in this file and admin/backupNow.ts
export type BackupEnv = Env & { BACKUPS: R2Bucket };

// ── Last-written key is exposed so admin command can report it ────────────────
export interface BackupResult {
  key:     string;
  bytes:   number;
  retained: number;
  deleted: number;
}

// ── Run the full backup ───────────────────────────────────────────────────────

export async function runWeeklyBackup(env: BackupEnv): Promise<BackupResult> {
  const now  = new Date();
  const yyyy = now.getUTCFullYear();
  const mm   = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(now.getUTCDate()).padStart(2, "0");
  const date = `${yyyy}-${mm}-${dd}`;
  const key  = `backup/${yyyy}/${mm}/${date}.json`;

  // ── 1. Dump all tables ────────────────────────────────────────────────────
  const [gymsRes, membersRes, paymentsRes, devPaymentsRes, notificationsRes, sessionsRes] =
    await env.DB.batch([
      env.DB.prepare("SELECT * FROM gyms ORDER BY id"),
      env.DB.prepare("SELECT * FROM members ORDER BY id"),
      env.DB.prepare("SELECT * FROM member_payments ORDER BY id"),
      env.DB.prepare("SELECT * FROM developer_payments ORDER BY id"),
      env.DB.prepare("SELECT * FROM notifications_sent ORDER BY id"),
      env.DB.prepare("SELECT * FROM sessions ORDER BY key"),
    ]);

  const payload = {
    exported_at: now.toISOString(),
    gyms:               gymsRes.results,
    members:            membersRes.results,
    member_payments:    paymentsRes.results,
    developer_payments: devPaymentsRes.results,
    notifications_sent: notificationsRes.results,
    sessions:           sessionsRes.results,
  };

  const jsonStr  = JSON.stringify(payload);
  const jsonBytes = new TextEncoder().encode(jsonStr);

  // ── 2. Upload to R2 ───────────────────────────────────────────────────────
  await env.BACKUPS.put(key, jsonBytes, {
    httpMetadata: { contentType: "application/json" },
  });

  // ── 3. Prune backups older than 90 days ───────────────────────────────────
  const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  let retained = 0;
  let deleted  = 0;

  // List all objects under "backup/" (R2 list returns up to 1000 at a time)
  let cursor: string | undefined;
  do {
    const listed = await env.BACKUPS.list({
      prefix: "backup/",
      cursor,
      limit: 1000,
    });

    for (const obj of listed.objects) {
      if (obj.uploaded < cutoff) {
        await env.BACKUPS.delete(obj.key);
        deleted++;
      } else {
        retained++;
      }
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  console.log(
    `[BACKUP] Wrote ${key}, size ${jsonBytes.byteLength} bytes, ` +
    `retained ${retained}, deleted ${deleted}`
  );

  return { key, bytes: jsonBytes.byteLength, retained, deleted };
}
