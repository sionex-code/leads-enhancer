#!/usr/bin/env node
// Builds the world city index used by live (extension) searches.
//
// The warehouse catalog only knows places we already hold leads for, which is
// the right answer for a warehouse lookup and the wrong one for a live scrape:
// the extension can grid anywhere on earth, so restricting its city list to our
// own coverage was an artificial limit.
//
// Source: https://github.com/dr5hn/countries-states-cities-database (ODbL).
// One CSV carries cities with their state and country denormalised in, so this
// single asset produces both the country list and the per-country city lists.
//
// Output (git-ignored, built on deploy — 19MB of CSV has no business in the repo):
//   data/geo/countries.json      [{ code, name, cityCount }]
//   data/geo/cities/<CC>.json    [{ n: name, s: state, la: lat, ln: lng, p: population }]
//
// Population is kept purely for ranking. "Austin" is a real place in Arkansas,
// Indiana, Minnesota and Texas; without a population to sort on, a search for it
// returns them in whatever order the file happens to hold, and the one nobody
// meant comes first.
//
// Split per country because the whole set is 153k rows: nothing should ever
// need to hold all of it in memory, and a request only ever wants one country.
//
// Usage: node scripts/build-geo-index.cjs [path/to/csv-cities.csv.gz]
//        (downloads the release asset when no path is given)

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const RELEASE =
  "https://github.com/dr5hn/countries-states-cities-database/releases/download/v3.2-export.7/csv-cities.csv.gz";
const OUT_DIR = path.join(__dirname, "..", "data", "geo");
const CITY_DIR = path.join(OUT_DIR, "cities");

// Minimal RFC4180 reader. The dataset has quoted fields containing commas (and
// plenty of non-Latin names), so splitting on "," would corrupt roughly every
// row with a comma in a native name.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function download(url) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    https
      .get(url, { headers: { "user-agent": "leadsfunda-geo-index" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(res.headers.location));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

async function main() {
  const arg = process.argv[2];
  let gz;
  if (arg) {
    console.log(`[geo] reading ${arg}`);
    gz = fs.readFileSync(arg);
  } else {
    console.log(`[geo] downloading ${RELEASE}`);
    gz = await download(RELEASE);
  }
  console.log(`[geo] ${(gz.length / 1048576).toFixed(1)} MB compressed`);

  const csv = zlib.gunzipSync(gz).toString("utf8");
  const rows = parseCsv(csv);
  const header = rows.shift();
  const col = (name) => header.indexOf(name);
  const iName = col("name");
  const iState = col("state_name");
  const iCode = col("country_code");
  const iCountry = col("country_name");
  const iLat = col("latitude");
  const iLng = col("longitude");
  const iPop = col("population");
  if ([iName, iState, iCode, iCountry, iLat, iLng].some((i) => i < 0)) {
    throw new Error(`unexpected CSV columns: ${header.join(",")}`);
  }

  const byCountry = new Map(); // code -> { name, cities: [] }
  let skipped = 0;
  for (const r of rows) {
    const code = r[iCode];
    const name = r[iName];
    const la = Number(r[iLat]);
    const ln = Number(r[iLng]);
    // A city with no usable coordinates cannot centre a search, so it would only
    // ever be a dead entry in the picker.
    if (!code || !name || !Number.isFinite(la) || !Number.isFinite(ln)) { skipped++; continue; }
    if (!byCountry.has(code)) byCountry.set(code, { name: r[iCountry] || code, cities: [] });
    const p = iPop >= 0 ? Number(r[iPop]) : 0;
    byCountry.get(code).cities.push({ n: name, s: r[iState] || "", la, ln, p: Number.isFinite(p) ? p : 0 });
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(CITY_DIR, { recursive: true });

  const countries = [];
  for (const [code, { name, cities }] of byCountry) {
    // Biggest first, so the picker's default list (nothing typed yet) is the
    // country's major cities rather than whatever sorts first alphabetically —
    // and so equally-named matches rank by which one people mean.
    cities.sort((a, b) => b.p - a.p || a.n.localeCompare(b.n));
    fs.writeFileSync(path.join(CITY_DIR, `${code}.json`), JSON.stringify(cities));
    countries.push({ code, name, cityCount: cities.length });
  }
  countries.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(OUT_DIR, "countries.json"), JSON.stringify(countries));

  const bytes = fs
    .readdirSync(CITY_DIR)
    .reduce((s, f) => s + fs.statSync(path.join(CITY_DIR, f)).size, 0);
  console.log(
    `[geo] ${countries.length} countries, ` +
      `${countries.reduce((s, c) => s + c.cityCount, 0).toLocaleString()} cities, ` +
      `${(bytes / 1048576).toFixed(1)} MB on disk${skipped ? `, ${skipped} skipped` : ""}`
  );
}

main().catch((e) => {
  console.error("[geo] failed:", e.message);
  process.exit(1);
});
