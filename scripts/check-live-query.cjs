// Lift the live-query helpers out of the shipped dashboard-home.js and drive
// them through the sequences a user actually performs. Extracted from source
// rather than reimplemented, so the test cannot pass while the app is broken.
const fs = require("node:fs");
const path = require("node:path");
const src = fs.readFileSync(path.join(__dirname, "..", "app", "dashboard-home.js"), "utf8");

function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`missing ${name} - refactored away?`);
  let depth = 0;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error(`unterminated ${name}`);
}

const names = ["livePlaceTextOf", "splitQueryText", "liveKeywordOf", "composeLiveQuery"];
const H = new Function(`${names.map(grab).join("\n")}; return {${names.join(",")}};`)();

// A miniature of the component's live state + the handlers that touch the box.
function makeForm() {
  const s = { query: "", liveService: "", liveCity: null, liveCountryName: "" };
  const place = () => H.livePlaceTextOf(s.liveCity, s.liveCountryName);
  const keyword = () => H.liveKeywordOf(s.liveService, s.query);
  return {
    state: s,
    typeInBox(text) { s.query = text; },
    pickCountry(name) {
      s.liveCountryName = name; s.liveCity = null;
      s.query = H.composeLiveQuery(keyword(), name);
    },
    pickPlace(city) {
      s.liveCity = city;
      s.query = H.composeLiveQuery(keyword(), [city.n, city.s, s.liveCountryName].filter(Boolean).join(", "));
    },
    pickService(svc) { s.liveService = svc; s.query = H.composeLiveQuery(svc, place()); },
    // Mirrors queryFromPickers()'s live branch: no warehouse fallback.
    submitted() {
      const svc = (s.liveService || "").trim();
      const p = place();
      return s.query.trim() || (svc && p ? `${svc} in ${p}` : "");
    },
  };
}

const PUNJAB = { n: "Punjab", s: "", province: true };
const LAHORE = { n: "Lahore", s: "Punjab" };
const SINDH = { n: "Sindh", s: "", province: true };

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`        box: ${JSON.stringify(actual)}${ok ? "" : `   expected ${JSON.stringify(expected)}`}`);
};

console.log("the reported bug - place chosen, no business type picked:");
let f = makeForm();
f.pickCountry("Pakistan");
check("after picking Pakistan, no invented keyword", f.state.query, "");
f.pickPlace(PUNJAB);
check("after picking Punjab, still no invented keyword", f.state.query, "");
check("submitting with nothing chosen refuses rather than inventing", f.submitted(), "");
f.pickService("hair transplant");
check("business type completes the search", f.state.query, "hair transplant in Punjab, Pakistan");

console.log("\ntyping the keyword first, then aiming it:");
f = makeForm();
f.typeInBox("hair transplant");
f.pickCountry("Pakistan");
check("typed keyword survives the country change", f.state.query, "hair transplant in Pakistan");
f.pickPlace(PUNJAB);
check("typed keyword survives the province change", f.state.query, "hair transplant in Punjab, Pakistan");

console.log("\nmoving an existing search somewhere else:");
f = makeForm();
f.typeInBox("hair transplant");
f.pickCountry("Pakistan");
f.pickPlace(LAHORE);
check("city keeps its state for disambiguation", f.state.query, "hair transplant in Lahore, Punjab, Pakistan");
f.pickPlace(SINDH);
check("switching province rewrites only the place", f.state.query, "hair transplant in Sindh, Pakistan");

console.log("\nbusiness type before any place:");
f = makeForm();
f.pickService("plumber");
check("keyword alone, no dangling 'in'", f.state.query, "plumber");
f.pickCountry("Pakistan");
check("place then attaches", f.state.query, "plumber in Pakistan");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
