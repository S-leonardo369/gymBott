# GymBott

Telegram bot for gym owners to track membership expiries.  
Built with Cloudflare Workers + D1 (SQLite) + grammY + TypeScript.

## Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- A Cloudflare account — `wrangler login`

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the D1 database

```bash
npx wrangler d1 create gymbott-db
```

Copy the `database_id` from the output and paste it into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "gymbott-db",
    "database_id": "<paste-id-here>"   // ← replace the placeholder
  }
]
```

### 3. Apply the migration

**Locally** (against a local SQLite file — no internet required):
```bash
npx wrangler d1 migrations apply gymbott-db --local
```

**Production** (pushes to Cloudflare D1):
```bash
npx wrangler d1 migrations apply gymbott-db --remote
```

### 4. Set secrets

```bash
npx wrangler secret put BOT_TOKEN   # paste your Telegram bot token when prompted
```

For local development, create `.dev.vars` (git-ignored):
```
BOT_TOKEN=your_bot_token_here
```

### 5. Register the webhook

After deploying, tell Telegram to send updates to your Worker URL:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://gymbott.<your-subdomain>.workers.dev"
```

### 6. Deploy

```bash
npm run deploy
```

---

## Development

```bash
npm run dev          # local dev server (HTTP, no webhook — use polling or ngrok)
npm run cf-typegen   # regenerate Cloudflare bindings types (worker-configuration.d.ts)
```

## Cron triggers

| Cron expression | UTC time | IST time | Purpose |
|-----------------|----------|----------|---------|
| `30 3 * * *` | 03:30 | 09:00 | Daily expiry reminders |
| `0 4 1 * *` | 04:00 on 1st | 09:30 on 1st | Monthly billing report |
