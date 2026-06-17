// filter-emails.js — keep only rows that have an email. Usage: node filter-emails.js in.csv out.csv
const fs = require("fs");
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
  return rows;
}
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const [inFile, outFile] = process.argv.slice(2);
const rows = parseCsv(fs.readFileSync(inFile, "utf8"));
const h = rows.shift();
const ei = h.indexOf("email");
const kept = rows.filter((r) => r[ei] && r[ei].includes("@"));
fs.writeFileSync(outFile, [h, ...kept].map((r) => r.map(csvEsc).join(",")).join("\n") + "\n");
console.log(`kept ${kept.length} leads with emails -> ${outFile}`);
