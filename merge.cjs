// merge.js — merge multiple scrape CSVs, dedupe by phone (fallback: name), write one CSV.
// Usage: node merge.js out.csv in1.csv in2.csv ...
const fs = require("fs");

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let field = "";
  let row = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const [out, ...inputs] = process.argv.slice(2);
let header = null;
const seen = new Set();
const merged = [];
for (const f of inputs) {
  const rows = parseCsv(fs.readFileSync(f, "utf8"));
  const h = rows.shift();
  if (!header) header = h;
  const nameIdx = h.indexOf("name");
  const phoneIdx = h.indexOf("phone");
  for (const r of rows) {
    const key = (r[phoneIdx] || "").replace(/\D/g, "") || (r[nameIdx] || "").toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
}
fs.writeFileSync(out, [header, ...merged].map((r) => r.map(csvEsc).join(",")).join("\n") + "\n");
console.log(`merged ${inputs.length} files -> ${merged.length} unique leads -> ${out}`);
