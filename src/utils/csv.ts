/**
 * Minimal RFC 4180 CSV parser + row validator for /admin_import.
 * No dependencies — works in Cloudflare Workers (V8 environment).
 */

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parses a CSV string into a 2-D array of strings (rows × cells).
 * Handles:
 *   - Quoted fields:            "foo,bar"  → one cell containing a comma
 *   - Escaped double quotes:    "say ""hi"""  → say "hi"
 *   - Multi-line quoted fields: preserved as-is (RFC 4180 compliant)
 *   - Both \r\n and \n line endings
 *   - Trailing newline at end of file (doesn't produce an extra empty row)
 * All non-quoted cell values are trimmed of surrounding whitespace.
 */
export function parseCsvRaw(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const flushField = () => {
    // Trim only unquoted content — quoted fields keep interior whitespace
    row.push(field.trim());
    field = "";
  };

  const flushRow = () => {
    flushField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < input.length && input[i + 1] === '"') {
          field += '"'; // "" inside quotes → literal "
          i += 2;
        } else {
          inQuotes = false; // closing quote
          i++;
        }
      } else {
        field += ch; // preserve everything inside quotes (including newlines)
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        flushField();
        i++;
      } else if (ch === "\r" && i + 1 < input.length && input[i + 1] === "\n") {
        flushRow();
        i += 2;
      } else if (ch === "\n") {
        flushRow();
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Flush any remaining content (file without trailing newline)
  const lastField = field.trim();
  if (lastField !== "" || row.length > 0) {
    row.push(lastField);
    rows.push(row);
  }

  return rows;
}

/**
 * High-level CSV parser: returns headers (lower-cased) and a list of
 * Record<header, value> rows. Empty rows (all-blank cells) are skipped.
 */
export function parseCsv(input: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const raw = parseCsvRaw(input);
  if (raw.length === 0) return { headers: [], rows: [] };

  const headers = raw[0].map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < raw.length; i++) {
    const cells = raw[i];
    if (cells.every((c) => c === "")) continue; // skip blank rows

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

// ── Date validator ────────────────────────────────────────────────────────────

/**
 * Returns true iff `s` is a valid YYYY-MM-DD date string.
 * Rejects invalid months (13), overflow days (Feb 30), etc.
 */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// ── Row validator ─────────────────────────────────────────────────────────────

export interface ValidatedImportRow {
  name: string;
  phone: string | null;
  amountPaid: number;
  admissionDate: string;
  expiryDate: string;
}

export interface RowError {
  rowNumber: number; // 1-based data row (header row = row 0)
  message: string;
}

const REQUIRED_HEADERS = [
  "name",
  "amount_paid",
  "admission_date",
  "expiry_date",
] as const;

/**
 * Checks that all required headers are present (case-insensitive — `parseCsv`
 * already lower-cases them). Returns the names of any that are missing.
 */
export function validateHeaders(headers: string[]): string[] {
  const set = new Set(headers);
  return REQUIRED_HEADERS.filter((h) => !set.has(h));
}

/**
 * Validates all data rows. Returns both the list of errors (for reporting)
 * and the list of successfully-parsed rows.
 *
 * All-or-nothing semantics are enforced by the caller: if errors.length > 0
 * nothing is inserted.
 */
export function validateRows(rows: Record<string, string>[]): {
  errors: RowError[];
  valid: ValidatedImportRow[];
} {
  const errors: RowError[] = [];
  const valid: ValidatedImportRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1; // 1-based
    const rowErrors: string[] = [];

    // ── name ──────────────────────────────────────────────────────────────────
    const name = (row["name"] ?? "").trim();
    if (name.length === 0) {
      rowErrors.push("name is empty");
    } else if (name.length < 2) {
      rowErrors.push(`name too short (min 2 chars), got '${name}'`);
    } else if (name.length > 60) {
      rowErrors.push(`name too long (max 60 chars), got ${name.length} chars`);
    }

    // ── phone (optional) ─────────────────────────────────────────────────────
    const phoneRaw = (row["phone"] ?? "").trim();
    let phone: string | null = null;
    if (phoneRaw !== "") {
      if (!/^\d{10}$/.test(phoneRaw)) {
        rowErrors.push(`phone must be 10 digits, got '${phoneRaw}'`);
      } else {
        phone = phoneRaw;
      }
    }

    // ── amount_paid ───────────────────────────────────────────────────────────
    const amountRaw = (row["amount_paid"] ?? "").trim();
    let amountPaid = 0;
    if (amountRaw === "") {
      rowErrors.push("amount_paid is required");
    } else {
      const n = Number(amountRaw);
      if (!Number.isInteger(n) || n < 100 || n > 100_000) {
        rowErrors.push(
          `amount_paid must be a whole number 100–100000, got '${amountRaw}'`
        );
      } else {
        amountPaid = n;
      }
    }

    // ── admission_date ────────────────────────────────────────────────────────
    const admissionDate = (row["admission_date"] ?? "").trim();
    let admissionOk = false;
    if (admissionDate === "") {
      rowErrors.push("admission_date is required");
    } else if (!isValidDate(admissionDate)) {
      rowErrors.push(
        `admission_date '${admissionDate}' is not a valid YYYY-MM-DD date`
      );
    } else {
      admissionOk = true;
    }

    // ── expiry_date ───────────────────────────────────────────────────────────
    const expiryDate = (row["expiry_date"] ?? "").trim();
    if (expiryDate === "") {
      rowErrors.push("expiry_date is required");
    } else if (!isValidDate(expiryDate)) {
      rowErrors.push(
        `expiry_date '${expiryDate}' is not a valid YYYY-MM-DD date`
      );
    } else if (admissionOk && expiryDate < admissionDate) {
      rowErrors.push(
        `expiry_date '${expiryDate}' is before admission_date '${admissionDate}'`
      );
    }

    if (rowErrors.length > 0) {
      for (const msg of rowErrors) {
        errors.push({ rowNumber: rowNum, message: msg });
      }
    } else {
      valid.push({ name, phone, amountPaid, admissionDate, expiryDate });
    }
  }

  return { errors, valid };
}
