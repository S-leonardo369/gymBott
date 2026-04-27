export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // TODO: wire up grammy webhook handler
    return new Response("OK");
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // TODO: dispatch to cron handlers based on event.cron
    switch (event.cron) {
      case "30 3 * * *":
        // daily expiry reminders
        break;
      case "0 4 1 * *":
        // monthly billing report
        break;
    }
  },
} satisfies ExportedHandler<Env>;
