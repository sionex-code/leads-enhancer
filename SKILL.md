---
name: gmaps-leads
description: Scrape Google Maps business leads, enrich them with emails/social links, audit websites with Lighthouse on desktop and mobile, and generate named project reports.
trigger: /gmaps-leads
---

# /gmaps-leads

Use this skill for conversational lead generation projects in `C:\Users\User\Desktop\gmaps-scraper`.

The workflow has five phases:

1. `scrape.js` - scrape Google Maps leads into CSV.
2. `enrich.js` - crawl lead websites for emails, contact pages, and social links.
3. `whatsapp.js` - check each lead's phone against WhatsApp (via the OpenWA API).
4. `analyze.js` - run Lighthouse website audits for desktop or mobile.
5. `report.js` - build one HTML lead report with contact details, WhatsApp status, and Lighthouse scores.

Prefer `project.js` for normal use because it stores files under `output\projects\<project-name>\` and lets the user resume, inspect, or delete by project name.

## Conversational mapping

When the user asks to scrape a named project:

```powershell
cd C:\Users\User\Desktop\gmaps-scraper
node project.js scrape "<project name>" --query "<business type/location>" --max <number>
```

When the user asks to enrich emails:

```powershell
node project.js enrich "<project name>"
```

When the user asks to check WhatsApp numbers (does this lead have WhatsApp / is the number on WhatsApp):

```powershell
node project.js whatsapp "<project name>"
```

When the user asks for a website audit, SEO report, mobile friendliness report, desktop report, or full report:

```powershell
node project.js audit "<project name>" --device all
node project.js report "<project name>"
```

When the user asks to resume:

```powershell
node project.js resume "<project name>"
```

When the user asks to check or delete a project:

```powershell
node project.js status "<project name>"
node project.js list
node project.js delete "<project name>" --yes
```

## Direct commands

Scrape without a project:

```powershell
node scrape.js "real estate agency miami" --max 50
```

Enrich the latest CSV in `output\`:

```powershell
node enrich.js
```

Check WhatsApp for the latest CSV in `output\` (writes `<input>-whatsapp.csv` with `whatsappExists`, `whatsappId`, `whatsappStatus`):

```powershell
node whatsapp.js
node whatsapp.js output\leads-enriched.csv --concurrency 2
```

Audit a specific CSV:

```powershell
node analyze.js output\leads-enriched.csv --device desktop
node analyze.js output\leads-enriched.csv --device mobile
```

Generate a report:

```powershell
node report.js output\leads-enriched.csv
```

## Operational notes

- Scraping opens a visible Chrome window by default. Avoid `--headless` unless the user specifically requests it.
- If Google shows consent/login instead of results, ask the user to accept it in the Chrome window, then rerun the scrape. The persistent `.chrome-profile\` remembers it.
- Scrape output is written incrementally, so stopping early keeps rows already captured.
- Enrichment resumes from `<input>.enrich-state.jsonl`; rerunning skips completed domains unless `--force` is used.
- WhatsApp checking calls the OpenWA API `GET /api/sessions/<sessionId>/contacts/check/<number>`; numbers are normalized to digits-only E.164 (country code + number, no `+`). Connection defaults are baked in but can be overridden with `--apiUrl`/`--sessionId`/`--apiKey` or the `OWA_API_URL`/`OWA_SESSION_ID`/`OWA_API_KEY` env vars. It resumes from `<input>.whatsapp-state.jsonl` (use `--force` to redo) and rate-limits itself to avoid the API's HTTP 429. In the pipeline it runs `--inplace`, adding `whatsappExists`/`whatsappId`/`whatsappStatus` columns to the enriched CSV so the report, dashboard, and leads DB all show WhatsApp status.
- Lighthouse resumes from `output\projects\<project>\lighthouse\<device>\.analyze-<device>-state.jsonl`; rerunning skips completed domains unless `--force` is used.
- Desktop and mobile audits write separate summaries: `<input>-lighthouse-desktop.csv` and `<input>-lighthouse-mobile.csv`.
- `report.js` joins enriched lead data with both Lighthouse summaries when present.
- For a quick Lighthouse smoke test, use `node analyze.js <csv> --maxSites 1 --device desktop --timeout 120000`.
