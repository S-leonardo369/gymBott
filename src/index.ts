import { Bot, webhookCallback, type Context } from "grammy";
import {
  conversations,
  createConversation,
  type ConversationFlavor,
} from "@grammyjs/conversations";
import { D1StorageAdapter } from "./db/sessions";

// ── Conversations ─────────────────────────────────────────────────────────────
import { onboardingConversation } from "./conversations/onboarding";
import { addMemberConversation }  from "./conversations/addMember";
import { renewMemberConversation } from "./conversations/renewal";

// ── Commands ──────────────────────────────────────────────────────────────────
import { startCommand }      from "./commands/start";
import { helpCommand }       from "./commands/help";
import { addCommand }        from "./commands/add";
import { listCommand }       from "./commands/list";
import { expiringCommand }   from "./commands/expiring";
import { cancelCommand }     from "./commands/cancel";
import { adminRunCronCommand } from "./admin/runCron";

// ── Callbacks ─────────────────────────────────────────────────────────────────
import { listPageCallback, expiringPageCallback } from "./callbacks/list";
import {
  cancelPickCallback,
  cancelConfirmCallback,
  cancelBackCallback,
} from "./callbacks/cancel";
import {
  renewCallback,
  notyetCallback,
  cancelMemberCallback,
  cancelMemberConfirmCallback,
  cancelMemberBackCallback,
} from "./callbacks/renewal";

// ── Cron ──────────────────────────────────────────────────────────────────────
import { runDailyCron } from "./cron/daily";

// ── Environment bindings ──────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;       // set via `wrangler secret put WEBHOOK_SECRET`
  DEVELOPER_TELEGRAM_ID?: string; // set via `wrangler secret put DEVELOPER_TELEGRAM_ID`
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

  // 1. Inject Cloudflare env into every context so handlers can reach DB/secrets.
  bot.use((ctx, next) => {
    ctx.env = env;
    return next();
  });

  // 2. Conversations plugin — D1-backed so state survives between Worker requests.
  bot.use(
    conversations<BotContext, Context>({
      storage: {
        type:    "key",
        version: 1,
        adapter: new D1StorageAdapter(env.DB),
      },
    })
  );

  // 3. Conversation handlers (must come after conversations() middleware).
  bot.use(createConversation<BotContext, Context>(onboardingConversation, "onboarding"));
  bot.use(createConversation<BotContext, Context>(addMemberConversation,  "addMember"));
  bot.use(createConversation<BotContext, Context>(renewMemberConversation, "renewMember"));

  // 4. Commands
  bot.command("start",          startCommand);
  bot.command("help",           helpCommand);
  bot.command("add",            addCommand);
  bot.command("list",           listCommand);
  bot.command("expiring",       expiringCommand);
  bot.command("cancel",         cancelCommand);
  bot.command("admin_run_cron", adminRunCronCommand);

  // 5. Callback query handlers
  //    /list and /expiring pagination
  bot.callbackQuery(/^list:\d+$/,     listPageCallback);
  bot.callbackQuery(/^expiring:\d+$/, expiringPageCallback);

  //    /cancel flow (from command — uses "cancel:" prefix)
  bot.callbackQuery(/^cancelpick:\d+$/,    cancelPickCallback);
  bot.callbackQuery(/^cancelconfirm:\d+$/, cancelConfirmCallback);
  bot.callbackQuery("cancelback",          cancelBackCallback);

  //    Cron notification buttons (use "cancelmember:" to avoid collision with /cancel)
  bot.callbackQuery(/^renew:\d+$/,              renewCallback);
  bot.callbackQuery(/^notyet:\d+$/,             notyetCallback);
  bot.callbackQuery(/^cancelmember:\d+$/,       cancelMemberCallback);
  bot.callbackQuery(/^cancelmemberconfirm:\d+$/, cancelMemberConfirmCallback);
  bot.callbackQuery("cancelmemberback",          cancelMemberBackCallback);

  return bot;
}

// ── Webhook secret verification ───────────────────────────────────────────────

async function safeCompare(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const keyBytes = enc.encode(a);
  const msgBytes = enc.encode(b);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac1 = await crypto.subtle.sign("HMAC", cryptoKey, msgBytes);
  const mac2 = await crypto.subtle.sign("HMAC", cryptoKey, keyBytes);
  const v1 = new Uint8Array(mac1);
  const v2 = new Uint8Array(mac2);
  let diff = 0;
  for (let i = 0; i < v1.length; i++) diff |= v1[i] ^ v2[i];
  return diff === 0;
}

async function verifyWebhookSecret(request: Request, env: Env): Promise<Response | null> {
  if (!env.WEBHOOK_SECRET) {
    console.warn(
      "[security] WEBHOOK_SECRET is not set. " +
        "Set it with `wrangler secret put WEBHOOK_SECRET` before going to production."
    );
    return null;
  }
  const incoming = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  const ok = await safeCompare(env.WEBHOOK_SECRET, incoming);
  if (!ok) {
    console.warn("[security] Rejected request: invalid webhook secret token.");
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

// ── Worker export ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const rejection = await verifyWebhookSecret(request, env);
    if (rejection) return rejection;

    const bot = makeBot(env);
    return webhookCallback(bot, "cloudflare-mod")(request);
  },

  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    switch (event.cron) {
      case "30 3 * * *":
        // Daily expiry reminders — 03:30 UTC = 09:00 IST
        await runDailyCron(env);
        break;

      case "0 4 1 * *":
        // TODO Phase 5: monthly developer billing
        break;
    }
  },
} satisfies ExportedHandler<Env>;
