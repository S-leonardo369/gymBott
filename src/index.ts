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

// ── Worker export ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
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
