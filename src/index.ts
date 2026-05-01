import { Bot, webhookCallback, type Context } from "grammy";
import {
  conversations,
  createConversation,
  type ConversationFlavor,
} from "@grammyjs/conversations";
import { D1StorageAdapter } from "./db/sessions";

// ── Conversations ─────────────────────────────────────────────────────────────
import { onboardingConversation }  from "./conversations/onboarding";
import { addMemberConversation }   from "./conversations/addMember";
import { renewMemberConversation } from "./conversations/renewal";
import { adminImportConversation } from "./conversations/adminImport";
import { editFieldConversation }   from "./conversations/editField";
import { feedbackConversation }    from "./conversations/feedback";

// ── Commands ──────────────────────────────────────────────────────────────────
import { startCommand }      from "./commands/start";
import { helpCommand }       from "./commands/help";
import { addCommand }        from "./commands/add";
import { listCommand }       from "./commands/list";
import { expiringCommand }   from "./commands/expiring";
import { cancelCommand, cancelCommandRouter } from "./commands/cancel";
import { adminRunCronCommand }   from "./admin/runCron";
import { adminImportCommand }    from "./admin/import";
import { adminReplyCommand }     from "./admin/reply";
import { adminBackupNowCommand } from "./admin/backupNow";
import { editCommand }     from "./commands/edit";
import { statsCommand }   from "./commands/stats";
import { exportCommand }  from "./commands/export";
import { feedbackCommand } from "./commands/feedback";

// ── Callbacks ─────────────────────────────────────────────────────────────────
import { listPageCallback, expiringPageCallback } from "./callbacks/list";
import {
  editPickCallback,
  editFieldCallback,
  editDoneCallback,
} from "./callbacks/edit";
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
import { runDailyCron }    from "./cron/daily";
import { runWeeklyBackup } from "./cron/backup";

// ── Keyboards ─────────────────────────────────────────────────────────────────
import { ownerKeyboard } from "./utils/keyboards";
import { getGymByTelegramId } from "./db/gyms";

// ── Environment bindings ──────────────────────────────────────────────────────

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;        // set via `wrangler secret put WEBHOOK_SECRET`
  DEVELOPER_TELEGRAM_ID?: string; // set via `wrangler secret put DEVELOPER_TELEGRAM_ID`
  BACKUPS?: R2Bucket;             // R2 bucket — bind in wrangler.jsonc
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
  bot.use(createConversation<BotContext, Context>(onboardingConversation,  "onboarding"));
  bot.use(createConversation<BotContext, Context>(addMemberConversation,   "addMember"));
  bot.use(createConversation<BotContext, Context>(renewMemberConversation, "renewMember"));
  bot.use(createConversation<BotContext, Context>(adminImportConversation, "adminImport"));
  bot.use(createConversation<BotContext, Context>(editFieldConversation,   "editField"));
  bot.use(createConversation<BotContext, Context>(feedbackConversation,    "feedback"));

  // 4. Commands
  bot.command("start",          startCommand);
  bot.command("help",           helpCommand);
  bot.command("add",            addCommand);
  bot.command("list",           listCommand);
  bot.command("expiring",       expiringCommand);
  bot.command("cancel",         cancelCommandRouter);
  bot.command("admin_run_cron", adminRunCronCommand);
  bot.command("admin_import",   adminImportCommand);
  bot.command("edit",              editCommand);
  bot.command("stats",             statsCommand);
  bot.command("export",            exportCommand);
  bot.command("feedback",          feedbackCommand);
  bot.command("admin_reply",       adminReplyCommand);
  bot.command("admin_backup_now",  adminBackupNowCommand);

  // 5. Callback query handlers
  //    /list and /expiring pagination
  bot.callbackQuery(/^list:\d+$/,     listPageCallback);
  bot.callbackQuery(/^expiring:\d+$/, expiringPageCallback);

  //    /edit flow
  bot.callbackQuery(/^editpick:\d+$/,              editPickCallback);
  bot.callbackQuery(/^editfield:[a-z]+:\d+$/,      editFieldCallback);
  bot.callbackQuery(/^editdone:\d+$/,              editDoneCallback);

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

  // 6. Reply-keyboard button handlers (hears = exact text match).
  //    Must come AFTER command handlers so commands are always preferred.
  //    Cast to `any` is safe — none of these handlers use ctx.match.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  bot.hears("➕ Add member",    (ctx) => addCommand(ctx as any));
  bot.hears("📋 List members",  (ctx) => listCommand(ctx as any));
  bot.hears("⚠️ Expiring",      (ctx) => expiringCommand(ctx as any));
  bot.hears("❌ Cancel member", (ctx) => cancelCommandRouter(ctx as any));
  bot.hears("❓ Help",          (ctx) => helpCommand(ctx as any));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // 7. Fallback: any unrecognised text message — re-attach the correct keyboard
  //    and give a gentle hint.  Must be LAST so nothing else gets shadowed.
  bot.on("message:text", async (ctx) => {
    const userId = String(ctx.from?.id);
    if (!userId || userId === "undefined") return;
    try {
      const gym = await getGymByTelegramId(ctx.env.DB, userId);
      if (gym) {
        await ctx.reply(
          "Use the buttons below or /help to see all commands.",
          { reply_markup: ownerKeyboard() }
        );
      } else {
        await ctx.reply("Send /start to register your gym.");
      }
    } catch {
      // Silently ignore fallback errors — don't spam error messages for noise
    }
  });

  // 8. Fallback: unsolicited document or photo (outside an active conversation).
  //    Conversations intercept first, so this only fires when no conversation
  //    is waiting for a file.
  bot.on(["message:document", "message:photo"], async (ctx) => {
    const userId = String(ctx.from?.id);
    if (!userId || userId === "undefined") return;
    try {
      const isAdmin =
        !!ctx.env.DEVELOPER_TELEGRAM_ID &&
        userId === ctx.env.DEVELOPER_TELEGRAM_ID;

      if (isAdmin) {
        await ctx.reply(
          "📎 To import members, send /admin_import <gym_id> first, " +
            "then attach the CSV when prompted."
        );
      } else {
        const gym = await getGymByTelegramId(ctx.env.DB, userId);
        if (gym) {
          await ctx.reply(
            "I can only handle text messages. Use the buttons below or send /help.",
            { reply_markup: ownerKeyboard() }
          );
        }
        // Non-onboarded non-admin: stay silent
      }
    } catch {
      // Silently ignore fallback errors
    }
  });

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

      case "0 21 * * 0":
        // Weekly R2 backup — 21:00 UTC Sunday
        if (env.BACKUPS) {
          await runWeeklyBackup(env as Env & { BACKUPS: R2Bucket });
        } else {
          console.warn("[BACKUP] BACKUPS R2 binding not configured — skipping.");
        }
        break;

      case "0 4 1 * *":
        // TODO Phase 5: monthly developer billing
        break;
    }
  },
} satisfies ExportedHandler<Env>;
