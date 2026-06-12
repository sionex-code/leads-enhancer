// One-time bootstrap: open Google Maps in real Chrome, capture the internal
// search?tbm=map XHR URL, and save its `pb` parameter as a reusable template
// with lat/lng/zoom-distance/offset turned into placeholders.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'pb-template.json');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ locale: 'en-US' });
const page = await ctx.newPage();

let captured = null;
page.on('request', (req) => {
  const u = req.url();
  if (!captured && u.includes('search?tbm=map') && u.includes('pb=')) {
    captured = u;
  }
});

await page.goto('https://www.google.com/maps/search/plumbers/@47.6062,-122.3321,12z?hl=en', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});

// Accept consent if shown
try {
  const btn = page.locator('button:has-text("Accept all"), button:has-text("I agree")').first();
  await btn.click({ timeout: 5000 });
} catch {}

// Scroll the feed once to force the XHR if it has not fired yet
const start = Date.now();
while (!captured && Date.now() - start < 45000) {
  try {
    await page.locator('div[role="feed"]').evaluate((el) => (el.scrollTop = el.scrollHeight));
  } catch {}
  await page.waitForTimeout(1000);
}

if (!captured) {
  console.error('FAILED: no search?tbm=map request observed');
  await browser.close();
  process.exit(1);
}

const url = new URL(captured);
let pb = url.searchParams.get('pb');
const q = url.searchParams.get('q');

// Parameterize: viewport distance (1d), lng (2d), lat (3d), page offset (8i)
pb = pb
  .replace(/!1d[0-9.eE+-]+/, '!1d{D}')
  .replace(/!2d[0-9.eE+-]+/, '!2d{LNG}')
  .replace(/!3d[0-9.eE+-]+/, '!3d{LAT}')
  .replace(/!8i\d+/, '!8i{OFFSET}')
  .replace(/!7i\d+/, '!7i20');

fs.writeFileSync(OUT, JSON.stringify({ pb, q, capturedAt: new Date().toISOString() }, null, 2));
console.log('Template saved to', OUT);
console.log('q =', q);
console.log('pb length =', pb.length);
await browser.close();
