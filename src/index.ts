import { Bot, webhookCallback, type Context } from "grammy";
import {
  conversations,
  createConversation,
  type ConversationFlavor,
} from "@grammyjs/conversations";
import { D1StorageAdapter } from "./db/sessions";
import { onboardingConversation } from "./conversations/onboarding";
import { startCommand } from "./commands/start";
import { helpCommand } from "./commands/help";

// ── Environment bindings ──────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET?: string; // optional — set via `wrangler secret put WEBHOOK_SECRET`
}

// ── Context types ─────────────────────────────────────────────────────────────

/**
 * Outside context — used in all middleware, commands, and callback handlers.
 * Has `ctx.env` (injected below) and `ctx.conversation` (from conversations plugin).
 */
export type BotContext = ConversationFlavor<Context & { env: Env }>;

// ── Bot factory ───────────────────────────────────────────────────────────────

function makeBot(env: Env): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN);

  // 1. Inject Cloudflare env into every context object so handlers can reach DB/secrets.
  bot.use((ctx, next) => {
    ctx.env = env;
    return next();
  });

  // 2. Conversations plugin — persists conversation state in D1 between requests.
  //    Inside conversation functions, use conversation.external(outerCtx => outerCtx.env.DB)
  //    to access the database; the outer context always has env injected.
  bot.use(
    conversations<BotContext, Context>({
      storage: {
        type: "key",
        version: 1, // bump this whenever conversation logic changes incompatibly
        adapter: new D1StorageAdapter(env.DB),
      },
    })
  );

  // 3. Register conversation handlers (must come after conversations() middleware).
  bot.use(createConversation<BotContext, Context>(onboardingConversation, "onboarding"));

  // 4. Commands
  bot.command("start", startCommand);
  bot.command("help", helpCommand);

  return bot;
}

// ── Webhook secret verification ───────────────────────────────────────────────

/**
 * Compares two strings in constant time to prevent timing attacks.
 * Falls back gracefully if the Web Crypto API is unavailable.
 */
async function safeCompare(a: string, b: string): Promise<boolean> {
  // Length check is not secret-dependent, so it's safe to short-circuit here.
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const keyBytes = enc.encode(a);
  const msgBytes = enc.encode(b);
  // HMAC-SHA256 of the incoming value keyed by the expected secret.
  // Equal strings produce equal MACs — equivalent to constant-time compare.
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac1 = await crypto.subtle.sign("HMAC", cryptoKey, msgBytes);
  const mac2 = await crypto.subtle.sign("HMAC", cryptoKey, keyBytes);
  // Both MACs are the same length; XOR every byte — any non-zero means mismatch.
  const v1 = new Uint8Array(mac1);
  const v2 = new Uint8Array(mac2);
  let diff = 0;
  for (let i = 0; i < v1.length; i++) diff |= v1[i] ^ v2[i];
  return diff === 0;
}

/**
 * Validates the X-Telegram-Bot-Api-Secret-Token header against WEBHOOK_SECRET.
 * Returns null if the request is allowed, or a 401 Response if it is not.
 */
async function verifyWebhookSecret(request: Request, env: Env): Promise<Response | null> {
  if (!env.WEBHOOK_SECRET) {
    // Secret not configured — warn and allow through (useful for local dev).
    console.warn(
      "[security] WEBHOOK_SECRET is not set. " +
        "Set it with `wrangler secret put WEBHOOK_SECRET` before going to production."
    );
    return null;
  }

  const incoming = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  const ok = await safeCompare(env.WEBHOOK_SECRET, incoming);
  if (!ok) {
    // Do NOT log the incoming value — it may be a probing attempt.
    console.warn("[security] Rejected request: invalid webhook secret token.");
    return new Response("Unauthorized", { status: 401 });
  }

  return null; // Allowed
}

// ── Worker export ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Verify Telegram's secret token before touching the bot logic.
    const rejection = await verifyWebhookSecret(request, env);
    if (rejection) return rejection;

    const bot = makeBot(env);
    return webhookCallback(bot, "cloudflare-mod")(request);
  },

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    // TODO Phase 4: daily expiry reminders
    // TODO Phase 5: monthly developer billing
    switch (event.cron) {
      case "30 3 * * *":
        break;
      case "0 4 1 * *":
        break;
    }
  },
} satisfies ExportedHandler<Env>;
