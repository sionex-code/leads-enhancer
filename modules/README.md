# Capability modules

The four heavy capabilities — **scraper**, **enrich**, **whatsapp**, **audit** — are
packaged here as pluggable modules so each can be changed in isolation and scaled
onto its own VPS independently. **By default every module runs in-process** (the app
behaves exactly as before). A module switches to a remote worker only when its
`*_WORKER_URL` env var is set.

## Layout

```
modules/
  registry.cjs        per-module config from env → { mode, workerUrl, secret }
  client.cjs          JSON-over-HTTP POST to a worker (+ x-worker-secret auth)
  shared/spawn.cjs    runProcess / runNodeStage / commandExists
  shared/batch-remote.cjs   ship CSV → worker → write returned CSV back
  <name>/index.cjs    the ONLY thing call sites import; dispatches local|remote
  <name>/local.cjs    wraps the existing in-process implementation
  <name>/remote.cjs   forwards the call to a worker
worker.cjs            standalone server a secondary VPS runs (repo root)
```

Call sites import `modules/<name>/index.cjs` and never the raw `enrich.cjs` /
`whatsapp.cjs` / `web-audit.cjs` again, so swapping backends needs no call-site edits.

## Public surface (per module)

| Module   | Dispatched (local→remote) | Always local |
|----------|---------------------------|--------------|
| scraper  | `runBatch(ctx)`           | `runScrapeToDir`, `findRawCsv` (worker core) |
| enrich   | `enrichSite(url)`, `runBatch(ctx)` | `closeBrowser`, `runFile` |
| whatsapp | `checkNumber(num)`, `runBatch(ctx)` | `normalizePhone`, `dialingCode`, `runFile` |
| audit    | `auditUrl(url,opts)`, `runBatch(ctx)` | `runReport(ctx)`, `runFile` |

`ctx` (built in `web-runner.cjs`) carries `{ ROOT, dir, projectName, userId, flags,
value, log, store }` — the project context a batch stage needs.

## Config (env)

```
SCRAPER_WORKER_URL / ENRICH_WORKER_URL / WHATSAPP_WORKER_URL / AUDIT_WORKER_URL
WORKER_SECRET                  shared secret (per-module override: <NAME>_WORKER_SECRET)
```

`isRemote(name)` is simply "is `<NAME>_WORKER_URL` non-empty". Unset → in-process.

## Running a worker on another VPS

```
# on the worker box (shares the same DATABASE_URL as the app)
WORKER_SECRET=… npm run worker -- --modules=scraper        # or WORKER_MODULES=scraper
# → [worker] listening on :8787 — modules: scraper
```

Then on the app: `SCRAPER_WORKER_URL=http://<worker>:8787` + the matching
`WORKER_SECRET`. Endpoints (mounted only for `--modules` you enable):

| Route             | Module   | Body                                   |
|-------------------|----------|----------------------------------------|
| `GET /health`     | —        | → `{ ok, modules }`                    |
| `POST /scraper/run`  | scraper  | `{ query, max, project, userId, mode, … }` → `{ csv, rows }` |
| `POST /enrich/site`  | enrich   | `{ website }` → `{ result }`           |
| `POST /enrich/batch` | enrich   | `{ params, inputs:[{name,data}] }` → `{ outputs }` |
| `POST /whatsapp/check` | whatsapp | `{ number }` → `{ result }`          |
| `POST /whatsapp/batch` | whatsapp | CSV round-trip                       |
| `POST /audit/url`    | audit    | `{ url, mobile, timeout }` → `{ result }` |
| `POST /audit/batch`  | audit    | CSV round-trip                         |

The leads DB is shared, so the scraper's realtime upserts land centrally; CSV files
travel over HTTP only so downstream local stages still have a file to read.

## Notes / limits

- `/scraper/run` holds one long-lived HTTP request for the whole scrape
  (`SCRAPER_HTTP_TIMEOUT_MS`, default 1h). Leads still land in the DB live regardless;
  the response just carries the CSV + completion. A poll-based job API can replace it
  later behind the same module seam.
- One `*_WORKER_URL` per module (no built-in round-robin across many workers yet).
- `site-report.startReportJob` stays a local orchestrator; only its per-URL `auditUrl`
  scans offload.
