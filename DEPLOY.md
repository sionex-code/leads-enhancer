# LeadsFunda — Production Deploy Checklist

The app is a Next.js 16 (App Router) server backed by Postgres (Supabase). It runs
as a single Node process under pm2 on the VPS (`onlano-prod`, 144.91.104.65) and is
served at the **root domain** `leadsfunda.com` (no basePath). The WordPress site is
retired/moved aside.

## 1. Environment (`.env` on the server)
Copy `.env.example` → `.env` and fill in:
- `DATABASE_URL` — Supabase **session pooler** URI (IPv4). The direct `db.<ref>` host
  is IPv6-only and will fail on the VPS. Password must be URL-encoded.
- `AUTH_SECRET` — `openssl rand -base64 32`
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
- `NEXTAUTH_URL=https://leadsfunda.com`, `AUTH_TRUST_HOST=true`
- `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_PLAN_19/35/49`, `WHOP_CHECKOUT_19/35/49`
- `MAX_CONCURRENT_JOBS=6`, `FEATURE_AGENT=0`
- `WAREHOUSE_URL` — base URL of the warehouse server (default `http://127.0.0.1:3200`); omit if co-located on the same VPS.
- `WAREHOUSE_TOKEN` — copy from `gmaps-scraper-standalone/.warehouse-token.txt` on the worker VPS.

## 2. Google OAuth (Google Cloud Console → Credentials → the OAuth client)
- Authorized JavaScript origin: `https://leadsfunda.com`
- Authorized redirect URI: `https://leadsfunda.com/api/auth/callback/google`
- (For local dev also add `http://localhost:3000` + `.../api/auth/callback/google`.)

## 3. Whop (dashboard)
- Create the product + 3 plans ($19/$35/$49); copy their plan IDs → `WHOP_PLAN_*`.
- Copy each plan's hosted checkout URL → `WHOP_CHECKOUT_*`.
- Add a webhook → `https://leadsfunda.com/api/webhooks/whop`; copy its signing
  secret → `WHOP_WEBHOOK_SECRET`. Subscribe to membership valid/invalid + payment events.

## 4. Database
```
npm ci
npm run db:migrate     # applies drizzle/*.sql to Postgres (idempotent)
```

## 5. Build + run
```
npm run build
pm2 start "npm run start:web" --name leadsfunda   # or update the existing pm2 app
pm2 save
```
The job-queue supervisor auto-starts via `instrumentation.js` (logs
`[queue] supervisor started (max 6 concurrent)`).

## 6. Nginx
Point `leadsfunda.com` (and `www`) at `http://127.0.0.1:3000`. Ensure the
`/api/webhooks/whop` path is **not** cached and the body is passed through
unbuffered (HMAC needs the raw body). Keep the existing proxy but drop any
basePath/`/leads` rewrite and the HTTP Basic auth.

## 7. Post-deploy smoke
- `https://leadsfunda.com/` → landing renders with logo + pricing.
- Sign in with Google → lands on `/dashboard`; `users`/`sessions` row created.
- Fire a test Whop webhook → `memberships` row created (matched by email); dashboard unlocks.
- Start a scrape → appears queued, runs (max 6 globally), notifies on completion.

## 8. Scaling a capability onto another VPS (optional)
The four heavy capabilities (scraper / enrich / whatsapp / audit) are pluggable
modules — in-process by default, offloadable to a worker on another box to balance
load. To move e.g. the **map scraper** to a second VPS:

1. On the new VPS: clone the repo, `npm ci`, `npm run install-chrome` (scraper/audit
   need Chrome). Set `.env` with the **same `DATABASE_URL`** (shared leads DB) and a
   `WORKER_SECRET`. The box only needs network access to Postgres + an open port.
2. Run the worker: `npm run worker -- --modules=scraper` (or `WORKER_MODULES=scraper`).
   It listens on `WORKER_PORT` (default 8787) and logs `[worker] listening …`.
3. On the main app's `.env`, set `SCRAPER_WORKER_URL=http://<new-vps>:8787` and the
   same `WORKER_SECRET` (or a per-module `SCRAPER_WORKER_SECRET`). Restart the app.

Now every scrape runs on the worker, which upserts leads into the shared DB in
realtime (they still appear live in `/leads`). Repeat per capability with
`ENRICH_WORKER_URL` / `WHATSAPP_WORKER_URL` / `AUDIT_WORKER_URL`. Leave a URL unset to
keep that capability in-process. Full details in `modules/README.md`.

## Notes / known follow-ups
- `project.cjs` (legacy CLI) and `web/lib/agent.cjs` (hidden AI agent) still call the
  old synchronous SQLite-era DB API; they are NOT used by the web app. Update them
  before re-enabling the agent (`FEATURE_AGENT=1`).
- The projects dashboard + leads table still use the legacy hand-written CSS; the new
  Tailwind/shadcn shell (landing, account/plan widget, sign-out) wraps them. A full
  table re-skin is the remaining UI polish.
- `scripts/queue-smoke.cjs` is a dev test and runs `DELETE FROM jobs` — never run in prod.
