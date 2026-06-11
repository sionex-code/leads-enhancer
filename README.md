# Google Maps Extreme Scraper

Fast, stealthy Google Maps lead scraper built on [patchright](https://www.npmjs.com/package/patchright) (undetected Playwright) driving **real Chrome**. It opens a Maps search, clicks each result, captures the full business panel, and writes a CSV **in scrape order** (first captured = top row).

## Captured fields (CSV column order)

`name, category, rating, reviews, website, websiteText, phone, address, plusCode, hours, imageUrls, mapsUrl`

## Install (already done)

```bash
npm install
npx patchright install chrome   # uses system Chrome if present
```

## Usage

```bash
# By search text
node scrape.js "real estate agency miami"

# By full Maps URL
node scrape.js "https://www.google.com/maps/search/real+estate+agency+miami"

# Limit results / run headless
node scrape.js "dentists in austin" --max 100
node scrape.js "plumbers london" --headless

# Fast network mode: read leads straight off the Maps RPC (no per-card clicking)
node scrape.js "dentists in austin" --network --max 200
```

Output goes to `./output/<slug>-<timestamp>.csv`. The file is **written incrementally**, so progress is never lost if you stop early.

### Capture modes

| Mode | Speed | Notes |
|------|-------|-------|
| DOM (default) | ~1.7 s/lead, slows as the list grows | Clicks each result card and reads the side panel. Most resilient; captures `plusCode`. |
| `--network` | ~20 places per scroll, stays flat | Decodes the `/search?tbm=map` responses — name, category, rating, reviews, website, phone (E.164), full address, hours, photos, mapsUrl. Much faster on large runs. Misses `plusCode` (not in the response). `--dom` forces the legacy path. |

### Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--max N` | unlimited | Stop after N leads |
| `--network` | off | Read leads from the Maps RPC instead of clicking cards (fast) |
| `--headless` | off | Run without a visible window |
| `--clickDelay` | 1200 | ms to wait after opening a place |
| `--closeDelay` | 500 | ms after closing a panel |
| `--scrollDelay` | 800 | ms after scrolling the feed |
| `--scrollAmount` | 1000 | px scrolled per step |
| `--maxNoCardRounds` | 12 | empty-scroll rounds before stopping |

## Contact enricher (emails + socials)

`enrich.js` visits each lead's **website** (plain HTTP, no browser — fast), crawls the homepage plus up to 3 contact/about pages, and extracts **emails, contact page URL, Facebook / Instagram / LinkedIn / Twitter**. Appends columns: `email, allEmails, contactPage, facebook, instagram, linkedin, twitter, enrichStatus`.

```bash
# Enrich the latest CSV in ./output
node enrich.js

# Enrich a specific file
node enrich.js output/dentists-in-austin-....csv

# Run ALONGSIDE the scraper: follows the CSV live, enriching rows as they're scraped
node enrich.js --watch

# Tune speed
node enrich.js --concurrency 12 --maxPages 5 --timeout 8000
```

Output: `<input>-enriched.csv` (same row order as the input).

**Resume:** every crawled site is saved to `<input>.enrich-state.jsonl` immediately. Stop anytime (Ctrl+C) and re-run the same command — already-done sites are skipped. Use `--force` to re-crawl everything. Duplicate domains are only crawled once.

| Flag | Default | Meaning |
|------|---------|---------|
| `--concurrency N` | 8 | sites crawled in parallel |
| `--maxPages N` | 4 | pages fetched per site (homepage + contact-ish pages) |
| `--timeout MS` | 10000 | per-request timeout |
| `--watch` | off | keep following the input CSV while the scraper writes it |
| `--force` | off | ignore saved state, re-enrich all |

Best email is auto-picked: prefers an address on the business's own domain, then `info@`/`contact@`-style boxes; `allEmails` keeps everything found.

## WhatsApp check

`whatsapp.js` takes every lead's **phone**, normalizes it to a digits-only E.164 id (country code + number, no `+`), and asks the [OpenWA](https://github.com/rmyndharis/OpenWA) API whether that number is registered on WhatsApp. Appends columns: `whatsappNumber, whatsappExists (yes/no), whatsappId, whatsappStatus`.

```bash
# Latest CSV in ./output (enriched preferred)
node whatsapp.js

# A specific CSV
node whatsapp.js output/dentists-in-austin-....csv

# Write the columns back INTO the input CSV (used by the pipeline)
node whatsapp.js output/leads-enriched.csv --inplace
```

Output: `<input>-whatsapp.csv` (or in place with `--inplace`).

**Resume:** every checked number is saved to `<input>.whatsapp-state.jsonl`; re-running skips already-checked numbers (`--force` to redo). The checker self-throttles (global min-gap + 429/5xx backoff) so it stays under the API's rate limit.

It calls `GET {apiUrl}/api/sessions/{sessionId}/contacts/check/{number}` with an `X-API-Key` header and reads `{ exists, whatsappId }` back.

| Flag | Default | Meaning |
|------|---------|---------|
| `--concurrency N` | 2 | numbers checked in parallel |
| `--minGap MS` | 120 | minimum gap between API calls (rate limit) |
| `--retries N` | 5 | retries on HTTP 429/5xx with backoff |
| `--timeout MS` | 15000 | per-request timeout |
| `--inplace` | off | write columns into the input CSV instead of a new file |
| `--force` | off | ignore saved state, re-check all |
| `--apiUrl URL` | env `OWA_API_URL` | OpenWA base url |
| `--sessionId ID` | env `OWA_SESSION_ID` | OpenWA session id |
| `--apiKey KEY` | env `OWA_API_KEY` | OpenWA `X-API-Key` |
| `--region CC` | env `OWA_DEFAULT_CC` | default country code for bare local numbers |

## Lighthouse audits and lead reports

`analyze.js` runs Google Lighthouse for every unique website in a lead CSV. It saves a full HTML + JSON Lighthouse report per site, plus a summary CSV with scores for performance, accessibility, best practices, and SEO.

```bash
# Desktop audit for the latest CSV
node analyze.js

# Mobile audit
node analyze.js output/dentists-in-austin-....csv --device mobile

# Build the lead dashboard after audits
node report.js output/dentists-in-austin-....csv
```

Useful flags:

| Flag | Default | Meaning |
|------|---------|---------|
| `--device desktop|mobile` | desktop | Run desktop or mobile Lighthouse mode |
| `--concurrency N` | 2 | Lighthouse workers |
| `--timeout MS` | 90000 | hard timeout per website |
| `--outDir DIR` | `lighthouse/<device>` | folder for full Lighthouse reports |
| `--summary FILE` | `<input>-lighthouse-<device>.csv` | scores summary CSV |
| `--maxSites N` | unlimited | audit only the first N pending sites |
| `--force` | off | ignore saved audit state |

## Named projects

Use `project.js` when you want the workflow to remember a project name and keep all outputs together under `output/projects/<project>/`.

```bash
# Create/scrape a project
node project.js scrape "Austin Dentists" --query "dentists in austin" --max 60

# Enrich emails/socials
node project.js enrich "Austin Dentists"

# Check which leads' phones are on WhatsApp
node project.js whatsapp "Austin Dentists"

# Run both desktop and mobile Lighthouse audits
node project.js audit "Austin Dentists" --device all

# Generate one HTML lead report with both score sets
node project.js report "Austin Dentists"

# Continue the next missing step
node project.js resume "Austin Dentists"

# Inspect or delete
node project.js status "Austin Dentists"
node project.js list
node project.js delete "Austin Dentists" --yes
```

Project `resume` uses existing state files where possible: enrichment skips completed domains, Lighthouse skips already audited domains, and the report rebuilds from the newest project CSV.

## Password-protected web UI

The Next.js UI wraps the same project workflow with live progress, lead rows, logs, stage controls, stop/resume, report links, and project-scoped browser cleanup.

```bash
# local dev
LEADS_UI_USER=admin LEADS_UI_PASSWORD=<password> npm run dev

# production
npm run build
LEADS_UI_USER=admin LEADS_UI_PASSWORD=<password> npm run start:web
```

For a subpath deployment, build and start with the same base path:

```bash
NEXT_PUBLIC_BASE_PATH=/leads npm run build
LEADS_UI_USER=admin LEADS_UI_PASSWORD=<password> NEXT_PUBLIC_BASE_PATH=/leads npm run start:web
```

On Linux, the web runner uses `xvfb-run` for the scraper when available. Browser history/profile cleanup is scoped to each project folder at `output/projects/<project>/browser-profile`.

## How it works

1. `scrape.js` launches a **persistent** Chrome profile (`.chrome-profile/`) with the spec's anti-detection config (`channel: "chrome"`, `viewport: null`, no custom UA/headers).
2. It handles the Google consent screen, waits for the results feed, then injects `inpage.js`.
3. `inpage.js` runs the capture loop inside the page: click card → read panel → store lead → close → scroll.
4. Node polls `window.__mapsLeads` and streams the CSV to disk in order.

## Notes

- Keep the browser window focused-ish; don't manually navigate while it runs.
- First run may show a Google consent/login page — accept it once; the persistent profile remembers it.
- To stop early: close the terminal (Ctrl+C). The CSV already on disk holds everything captured so far.
