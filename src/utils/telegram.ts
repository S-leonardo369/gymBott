/**
 * Thin wrapper around the Telegram Bot API for use in cron handlers where we
 * have no grammy Bot/Context — only a raw bot token.
 *
 * Retries on HTTP 429 (rate-limit) using the Retry-After header value.
 * All other errors are logged and return false so the cron can continue.
 */

const TELEGRAM_API = "https://api.telegram.org";

export interface InlineButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboard = InlineButton[][];

export interface SendMessageOptions {
  keyboard?: InlineKeyboard;
  maxRetries?: number;
}

/**
 * Sends a Telegram message to `chatId` using the raw HTTP Bot API.
 * Returns true if the message was accepted by Telegram, false otherwise.
 *
 * @param token      - The bot token (env.BOT_TOKEN)
 * @param chatId     - Telegram chat / user ID (numeric string or number)
 * @param text       - HTML-formatted message text
 * @param options    - Optional inline keyboard and retry count
 */
export async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
  options: SendMessageOptions = {}
): Promise<boolean> {
  const { keyboard, maxRetries = 3 } = options;
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id:    chatId,
    text,
    parse_mode: "HTML",
  };
  if (keyboard) {
    body.reply_markup = { inline_keyboard: keyboard };
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
    } catch (networkErr) {
      console.error(`[telegram] Network error on attempt ${attempt}:`, networkErr);
      if (attempt === maxRetries) return false;
      continue;
    }

    if (res.ok) return true;

    // Parse error body for logging
    let errData: { ok: boolean; error_code?: number; description?: string } = { ok: false };
    try {
      errData = (await res.json()) as typeof errData;
    } catch {
      // ignore parse error
    }

    if (res.status === 429) {
      // Rate limited — honour Retry-After, then loop
      const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
      console.warn(`[telegram] Rate limited. Retrying after ${retryAfter}s (attempt ${attempt}/${maxRetries})`);
      await sleep(retryAfter * 1_000);
      continue;
    }

    // Non-retriable: bot blocked, chat not found, bad token, etc.
    console.error(
      `[telegram] sendMessage failed (chat ${chatId}, attempt ${attempt}):`,
      errData.description ?? res.statusText
    );
    return false;
  }

  // Exhausted retries (only reachable after repeated 429s)
  console.error(`[telegram] sendMessage: exhausted ${maxRetries} retries for chat ${chatId}`);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
