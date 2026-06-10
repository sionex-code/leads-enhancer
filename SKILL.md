---
name: gmaps-leads
description: Scrape Google Maps business leads (name, phone, website, address, rating, hours) to CSV, then enrich each lead with emails + social links crawled from their website. Fast, resumable, dedupe built in.
trigger: /gmaps-leads
---

# /gmaps-leads

Generate business leads from Google Maps and enrich them with contact details. Two tools, both in `C:\Users\User\Desktop\gmaps-scraper`:

1. **scrape.js** — patchright (stealth Playwright) + real Chrome. Opens a Maps search, clicks every result, captures the side panel, streams CSV in scrape order.
2. **enrich.js** — pure-HTTP crawler (no browser). Visits each lead's website (homepage + contact/about pages), extracts emails, contact page, Facebook/Instagram/LinkedIn/Twitter. Resumable.

## Quick start (the 90% case)

```powershell
cd C:\Users\User\Desktop\gmaps-scraper

# 1. Scrape leads (visible Chrome window opens — REQUIRED, do not run headless)
node scrape.js "real estate agency miami" --max 50

# 2. Enrich the CSV it just wrote (picks the latest in output/ automatically)
node enrich.js
```

Output: `output\<query>-<timestamp>.csv` and `...-enriched.csv`.

To run both at once: start the scrape, then in a second shell run `node enrich.js --watch` — it follows the growing CSV and enriches rows live.

## scrape.js

```powershell
node scrape.js "<search text or full maps URL>" [flags]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--max N` | unlimited | stop after N leads |
| `--clickDelay MS` | 1200 | wait after opening a place panel |
| `--closeDelay MS` | 500 | wait after closing the panel |
| `--headless` | off | **avoid** — the click→side-panel flow needs a maximized visible window |

CSV columns: `name, category, rating, reviews, website, websiteText, phone, address, plusCode, hours, imageUrls, mapsUrl`. Written incrementally — Ctrl+C keeps everything captured so far.

## enrich.js

```powershell
node enrich.js [path\to\leads.csv] [flags]   # no path = latest CSV in output/
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--concurrency N` | 8 | sites crawled in parallel |
| `--maxPages N` | 4 | pages fetched per site |
| `--timeout MS` | 10000 | per-request timeout |
| `--watch` | off | follow a CSV the scraper is still writing |
| `--force` | off | ignore saved state, re-crawl everything |

Adds columns: `email, allEmails, contactPage, facebook, instagram, linkedin, twitter, enrichStatus`. Best email = own-domain first, then info@/contact@.

**Resume:** state is appended to `<input>.enrich-state.jsonl` after every site. Re-running the same command skips completed sites. Duplicate domains are crawled once.

## Agent playbook

- Run commands with a generous timeout (scrape ≈ 3 s/lead; enrich ≈ 19 sites/30 s at default concurrency).
- Scraper progress prints `Captured N leads...`; enricher prints one line per site (`[n] domain -> email|status`).
- First run on a fresh machine: `npm install` then `npx patchright install chrome` inside the project folder.
- If the scraper warns "Results feed not found": a Google consent/login page is showing — tell the user to accept it in the Chrome window once (persistent profile `.chrome-profile/` remembers it), then re-run.
- Don't navigate or resize the Chrome window while scraping — the feed + side panel must stay visible together.
- `enrichStatus` values: `ok (N emails)`, `no email found`, `no website`, `error: <code>` (dead/blocked sites are normal; they don't stop the run).
- To redo one site: delete its line from the `.enrich-state.jsonl` and re-run (or `--force` for all).
- Full docs: `C:\Users\User\Desktop\gmaps-scraper\README.md`.
