const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Returns today's date in UTC as 'YYYY-MM-DD'. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Adds n days to a 'YYYY-MM-DD' string, returns 'YYYY-MM-DD'.
 * Pure UTC arithmetic — no timezone surprises.
 */
export function addDays(date: string, n: number): string {
  const ms = new Date(date + "T00:00:00Z").getTime() + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Formats 'YYYY-MM-DD' → '28 Apr 2026'. */
export function formatDate(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const mon = MONTHS[d.getUTCMonth()];
  const yr  = d.getUTCFullYear();
  return `${day} ${mon} ${yr}`;
}

/**
 * Returns (b − a) in whole days.
 * Positive → b is in the future relative to a.
 * Negative → b is in the past.
 */
export function daysBetween(a: string, b: string): number {
  const msA = new Date(a + "T00:00:00Z").getTime();
  const msB = new Date(b + "T00:00:00Z").getTime();
  return Math.round((msB - msA) / 86_400_000);
}
