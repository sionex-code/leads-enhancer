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
```

Output goes to `./output/<slug>-<timestamp>.csv`. The file is **written incrementally**, so progress is never lost if you stop early.

### Options

| Flag | Default | Meaning |
|------|---------|---------|
| `--max N` | unlimited | Stop after N leads |
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

## How it works

1. `scrape.js` launches a **persistent** Chrome profile (`.chrome-profile/`) with the spec's anti-detection config (`channel: "chrome"`, `viewport: null`, no custom UA/headers).
2. It handles the Google consent screen, waits for the results feed, then injects `inpage.js`.
3. `inpage.js` runs the capture loop inside the page: click card → read panel → store lead → close → scroll.
4. Node polls `window.__mapsLeads` and streams the CSV to disk in order.

## Notes

- Keep the browser window focused-ish; don't manually navigate while it runs.
- First run may show a Google consent/login page — accept it once; the persistent profile remembers it.
- To stop early: close the terminal (Ctrl+C). The CSV already on disk holds everything captured so far.
