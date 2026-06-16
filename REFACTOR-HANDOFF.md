# LeadsFunda refactor — session handoff

Branch: `saas-leadsfunda`. Big multi-feature change in progress. `.js` scraper files
are ESM shims (`import "./X.cjs"`) — **edit the `.cjs` files**. All edited `.cjs`
pass `node --check`. Track via the harness task list (#1–#8).

## Original request (5 asks)
1. Remove the Gmail account feature (no longer needed).
2. Admin panel: add HTTPS proxies; scraper uses a **random** proxy per scrape so it
   doesn't reuse the same IP.
3. A **separate, shared enrichment DB**: once a site is enriched it's enriched for
   all users; if the same company/number reappears and is already enriched, show the
   cached enriched data.
4. Each website report generation costs **10 credits**.
5. Bulk report must warn "this will use N×10 credits — continue?" before running.

## Decisions from the user (clarifying Q&A)
- **Credits model**: per-plan credit balance + user top-up (custom pricing later).
  **Reduce pricing to $19 / $35 / $49.** Admin option to enable **free 100 credits/
  month** for signups, with **per-user adjustable** credit values in admin.
- **Reports**: per-lead website report (existing `siteReport`) + **multi-select bulk
  in `/leads`**, 10 credits each, confirm dialog.
- **Proxies**: applied to grid scraper (per request) + enrichment fetch (per request)
  + browser scrapers (per launch).

## Plan/credit model (implemented in `web/lib/billing.cjs`)
- Keys `p19/p35/p49` → prices 19/35/49, lead quotas 5000/50000/unlimited(null).
- `PLAN_CREDITS = {p19:500, p35:1500, p49:4000}` monthly. `REPORT_COST = 10`.
- Free (no plan) monthly grant = `app_settings.free_monthly_credits` (default 100),
  gated by `free_monthly_credits_enabled`. Per-user override `memberships.credits_monthly`.
- Monthly grant is **lazy** (`ensureCredits` on read, tracked by `credits_renewed_at`
  month). `consumeCredits` is atomic. Whop env: `WHOP_PLAN_19/35/49`, `WHOP_CHECKOUT_19/35/49`.

## DONE — Tasks #1–#4

### #1 Schema + startup migrate ✅
- `web/lib/schema.cjs`: memberships += `credits`,`credits_monthly`,`credits_renewed_at`;
  new tables `appSettings`, `proxies` (global), `enrichmentCache` (global, domain
  unique + phone idx); `gmailAccounts` marked deprecated (table kept); exports updated.
- `web/lib/migrate.cjs` (NEW): idempotent `ensureSchema()` — ALTER/CREATE IF NOT
  EXISTS, default app_settings, one-time guarded plan-key rename (p49→p35, p99→p49,
  flag `migrated_plan_keys_v1`).
- `instrumentation.js`: `await ensureSchema()` before `queue.start()`.
- `drizzle/0002_credits_proxies_enrichment.sql` (NEW): record-keeping.

### #2 Billing/credits + pricing ✅
- `web/lib/billing.cjs` rewritten (see model above). New exports: PLAN_PRICES,
  PLAN_CREDITS, PLAN_LABELS, REPORT_COST, getSetting/setSetting,
  getFreeMonthlyConfig/setFreeMonthlyConfig, ensureCredits, getCredits,
  consumeCredits, addCredits, setUserCredits, setUserMonthlyCredits. getEntitlement
  now returns `credits`+`creditsMonthly`. listUsersWithEntitlement selects credits.
- `app/api/billing/checkout/route.js`: PLAN_ENV/CHECKOUT_ENV → p19/p35/p49.

### #3 Remove Gmail accounts ✅
- `web/lib/db.cjs`: removed account CRUD + nextAccount + exports.
- `web/lib/store.cjs`: removed writeRotatedCookies + export.
- `web-runner.cjs`: removed import + cookie-rotation block in runScrape.
- Deleted `app/api/accounts/`. `app/dashboard-home.js`: removed AccountsPanel,
  state, handlers, render, unused imports (KeyRound/Plus/Textarea).
- (`scrape.cjs` still has a generic `--cookies` flag — harmless, left.)

### #4 Proxy pool ✅
- `web/lib/db.cjs`: normalizeProxyUrl, listProxies, listEnabledProxyUrls,
  addProxies, deleteProxy, setProxyEnabled + exports.
- `web/lib/proxy.cjs` (NEW): loadProxyUrls (env `GMAPS_PROXIES` → DB, 60s cache),
  pickRandom, proxyDispatcher (undici ProxyAgent), randomDispatcher,
  parseForPlaywright, randomPlaywrightProxy.
- `gridscrape.cjs`/`enrich.cjs`: per-request random `dispatcher` on fetch;
  enrich browser + `scrape.cjs` use one proxy per launch.
- `package.json`: `"undici": "^7.27.2"`.
- `app/api/admin/proxies/route.js` (NEW): GET/POST/PATCH/DELETE (admin-gated).
- `app/admin/AdminClient.js`: ProxyManager component + maskProxy + render + imports.

## TODO — Tasks #5–#8

### #5 Shared enrichment cache (IN PROGRESS)
Just read `app/api/leads/[id]/enrich/route.js` (uses `db` + `enrichLib.enrichSite`,
result keys: email, allEmails, contactPage, facebook, instagram, linkedin, twitter,
youtube, tiktok, pinterest, whatsapp, telegram, enrichStatus).
- `web/lib/db.cjs`: add `getCachedEnrichment({domain,phone})`, `getCachedEnrichmentMap(domains[])`,
  `saveCachedEnrichment(fields)` (upsert by domain, COALESCE NULLIF merge; skip if no
  domain). Cache cols mirror enrich keys (snake_case). Export them.
- `upsertLeads` (db.cjs) = central populate+consume:
  (a) before insert: bulk-fetch cache for all batch domains, fill each lead's MISSING
  enrichment fields from cache; (b) after insert: for leads WITH enrichment, save to cache.
  This covers scrape→sync and manual lead create.
- `app/api/leads/[id]/enrich/route.js`: before `enrichSite`, check cache by
  domain/phone → if hit with email, apply via updateLeadFields and return (skip crawl);
  after fresh enrich, saveCachedEnrichment.
- OPTIONAL: enrich.cjs batch pre-check to skip re-crawl (upsertLeads already covers
  populate/consume, so this is just an optimization — skip if risky).

### #6 Reports cost 10 credits + bulk select
- `app/api/leads/[id]/report/route.js` POST: import billing; before
  `siteReport.startReportJob`, `consumeCredits(userId, REPORT_COST)`; if `!ok` return
  402 `{error, credits}`.
- NEW `app/api/leads/report/bulk/route.js` POST `{ids:[]}`: load user's leads w/
  website; cost = REPORT_COST*count; consumeCredits; if insufficient 402; chunk into
  `siteReport.startReportJob` batches of `siteReport.MAX_SITES` (=5); refund via
  addCredits if a chunk throws. Return `{jobIds, charged}`.
- `app/leads/LeadsClient.js` (LARGE — read fully first; ~2 table render spots near
  lines 883 & 959): row checkbox + select-all, selection state, bulk bar
  "Generate reports (N×10 = M credits)" → confirm dialog showing cost + balance
  (from `/api/me`) → POST bulk route. Handle insufficient credits.
- `/api/me` already returns `entitlement.credits` (verify). `ReportModal`/drawer:
  optionally show "10 credits".

### #7 Admin per-user credits + free-monthly setting
- `app/api/admin/users/route.js` POST: also accept `{userId, credits}` →
  setUserCredits and `{userId, creditsMonthly}` → setUserMonthlyCredits. Fix
  validation `["p19","p49","p99"]` → `["p19","p35","p49"]` (+comment).
- NEW `app/api/admin/settings/route.js`: GET getFreeMonthlyConfig; POST
  `{enabled,amount}` setFreeMonthlyConfig (admin-gated).
- `app/admin/AdminClient.js`: PLAN_LABEL/PLAN_OPTIONS → p19/p35/p49 (19/35/49);
  `u.plan==="p99"`→`"p49"`; add credits column + inline editor (POST {userId,credits},
  optional monthly override); add global "Free monthly credits" card (toggle+amount →
  /api/admin/settings).

### #8 Pricing UI + smoke check
- `app/billing/BillingClient.js`: PLANS → p19/p35/p49, prices 19/35/49, quotaLabels,
  credits in perks; fix `planKey==="p99"`→`"p49"`.
- `app/components/Landing.js` (lines ~38-43): PLANS → p19/p35/p49, prices, credits.
- `app/components/AccountWidget.js`: PLAN_LABEL/PLAN_QUOTA → p19/p35/p49;
  `planKey==="p99"`→`"p49"`; offerable PLANS labels $19/$35/$49; **show credits balance**
  (ent.credits) — overlaps #6.
- `app/page.js` (lines 13-14): WHOP_CHECKOUT_49/99 → 35/49 (map keys p49/p99 → p35/p49).
  Read first.
- `app/layout.js`: check for plan/price refs (matched the price grep).
- `.env.example`: read + update WHOP_PLAN_/CHECKOUT_ to _19/_35/_49.
- Smoke: `node --check` all edited .cjs; ideally `npm run build` (or eyeball imports).

## Remaining files still referencing OLD keys (p49/p99) to fix in #7/#8
AccountWidget.js, BillingClient.js, Landing.js, AdminClient.js (PLAN_LABEL/OPTIONS +
unlimited check), app/page.js, app/api/admin/users/route.js (validation+comment),
app/dashboard-home.js (line ~283 `ent?.plan === "p99"` unlimited check — fix to p49).

Delete this file when the refactor is complete.
