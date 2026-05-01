import type { Env } from "../index";

// ── Result shape ──────────────────────────────────────────────────────────────

export interface BackupResult {
  date:     string;  // YYYY-MM-DD
  bytes:    number;  // size of the JSON payload
  gyms:     number;  // row counts
  members:  number;
  payments: number;
  sent:     boolean; // whether Telegram accepted the upload
}

// ── Run the full backup ───────────────────────────────────────────────────────

export async function runWeeklyBackup(env: Env): Promise<BackupResult> {
  const now  = new Date();
  const yyyy = now.getUTCFullYear();
  const mm   = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(now.getUTCDate()).padStart(2, "0");
  const date = `${yyyy}-${mm}-${dd}`;
  const filename = `gymbott_backup_${date}.json`;

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

  const gymsCount     = gymsRes.results.length;
  const membersCount  = membersRes.results.length;
  const paymentsCount = paymentsRes.results.length;

  const payload = {
    exported_at: now.toISOString(),
    gyms:               gymsRes.results,
    members:            membersRes.results,
    member_payments:    paymentsRes.results,
    developer_payments: devPaymentsRes.results,
    notifications_sent: notificationsRes.results,
    sessions:           sessionsRes.results,
  };

  const jsonStr   = JSON.stringify(payload, null, 2);
  const jsonBytes = new TextEncoder().encode(jsonStr);

  // ── 2. Guard: need DEVELOPER_TELEGRAM_ID to send ─────────────────────────
  if (!env.DEVELOPER_TELEGRAM_ID) {
    console.warn("[BACKUP] DEVELOPER_TELEGRAM_ID not set — backup not sent.");
    return {
      date, bytes: jsonBytes.byteLength,
      gyms: gymsCount, members: membersCount, payments: paymentsCount,
      sent: false,
    };
  }

  // ── 3. Send JSON as a document to the developer via Bot API ───────────────
  const caption =
    `🗄 Weekly backup ${date}\n` +
    `Gyms: ${gymsCount}, Members: ${membersCount}, Payments: ${paymentsCount}`;

  const form = new FormData();
  form.append("chat_id",  env.DEVELOPER_TELEGRAM_ID);
  form.append("caption",  caption);
  form.append(
    "document",
    new Blob([jsonBytes], { type: "application/json" }),
    filename
  );

  const apiUrl  = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendDocument`;
  const response = await fetch(apiUrl, { method: "POST", body: form });

  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    console.error(`[BACKUP] Telegram sendDocument failed: ${response.status} — ${body}`);
    return {
      date, bytes: jsonBytes.byteLength,
      gyms: gymsCount, members: membersCount, payments: paymentsCount,
      sent: false,
    };
  }

  console.log(
    `[BACKUP] Sent ${filename} to Telegram, ` +
    `${jsonBytes.byteLength} bytes, ` +
    `gyms=${gymsCount} members=${membersCount} payments=${paymentsCount}`
  );

  return {
    date, bytes: jsonBytes.byteLength,
    gyms: gymsCount, members: membersCount, payments: paymentsCount,
    sent: true,
  };
}
