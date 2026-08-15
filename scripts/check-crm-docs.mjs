// Check every adapter's "Where do I find this?" link. A status code is not
// enough: Smartlead's dead article answered 200 with a "Not found" body.
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const crm = require("./web/lib/crm/index.cjs");

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
let bad = 0;
for (const p of crm.list()) {
  if (!p.docsUrl) { console.log(`  --   ${p.label}: no docs link`); continue; }
  try {
    const res = await fetch(p.docsUrl, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
    const body = await res.text();
    const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || "";
    const soft = /not found|page not found|404/i.test(title);
    const hopped = res.url.replace(/\/$/, "") !== p.docsUrl.replace(/\/$/, "");
    const ok = res.ok && !soft;
    if (!ok) bad++;
    console.log(`${ok ? "  ok " : "BAD "} ${p.label.padEnd(10)} ${res.status} ${soft ? "SOFT-404 " : ""}${hopped ? "redirect " : ""}"${title.slice(0, 44)}"`);
    if (hopped) console.log(`        -> ${res.url}`);
  } catch (e) {
    bad++;
    console.log(`BAD  ${p.label.padEnd(10)} ${e.message}`);
  }
}
console.log(bad ? `\n${bad} broken` : "\nall docs links good");
process.exit(bad ? 1 : 0);
