#!/usr/bin/env node
// Catch an import that shadows a global constructor the same file uses.
//
// `import { Map } from "lucide-react"` binds Map for the whole module, so every
// `new Map()` in it throws "Map is not a constructor". It compiles cleanly, it
// type-checks, and the page dies at import time - which for a module-scope
// `new Map()` means the whole route 500s before it renders a byte.
//
// Nothing else catches it: the build succeeds, and an unauthenticated request
// to a guarded page redirects before the module is ever imported, so smoke
// tests come back green too. Hence a check of its own.
//
//   node scripts/check-shadowed-globals.cjs
const fs = require("node:fs");
const path = require("node:path");

// Globals worth protecting: ones that are constructors AND plausible icon or
// component names. Set/Map/Image are the ones that actually bite.
const GUARDED = new Set([
  "Map", "Set", "WeakMap", "WeakSet", "Image", "Text", "Range", "Request",
  "Response", "Headers", "URL", "Event", "Option", "Audio", "Notification",
  "Worker", "File", "Blob", "Path", "Date", "Number", "String", "Boolean",
  "Array", "Object", "Error", "Promise", "Proxy", "Symbol", "RegExp",
]);

const ROOTS = ["app", "web", "scripts"];
const EXT = /\.(js|jsx|cjs|mjs|ts|tsx)$/;

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (EXT.test(e.name)) yield full;
  }
}

// Comments go first, before anything is split on commas. Stripping per-comma
// instead does not work: prose inside an import block contains commas of its
// own, so the split hands back fragments whose leading `//` was consumed by the
// previous fragment - and the real binding hides at the tail of one of them.
// Only whole-line comments are removed, so a "https://…" inside a string is
// left alone.
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// Named bindings introduced by `import { A, B as C } from "..."`. Only the
// local name matters - `Map as MapIcon` is exactly the fix, so it must pass.
function importedLocals(src) {
  const names = new Set();
  const re = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
  let m;
  while ((m = re.exec(src))) {
    for (const part of m[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const as = piece.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      const local = as ? as[1] : piece.split(/\s+/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(local)) names.add(local);
    }
  }
  return names;
}

const root = process.cwd();
const problems = [];

for (const dir of ROOTS) {
  for (const file of walk(path.join(root, dir))) {
    const src = stripComments(fs.readFileSync(file, "utf8"));
    if (!src.includes("import")) continue;
    const locals = importedLocals(src);
    for (const name of locals) {
      if (!GUARDED.has(name)) continue;
      // Used as a constructor anywhere in the same module?
      const used = new RegExp(`\\bnew\\s+${name}\\s*\\(`).test(src);
      if (used) {
        problems.push({ file: path.relative(root, file), name });
      }
    }
  }
}

if (problems.length) {
  console.error("Imports shadowing a global constructor used in the same file:\n");
  for (const p of problems) {
    console.error(`  ${p.file}`);
    console.error(`    imports "${p.name}", which the file also calls as new ${p.name}().`);
    console.error(`    Fix: import it aliased, e.g. { ${p.name} as ${p.name}Icon }.\n`);
  }
  process.exit(1);
}

console.log("No imports shadow a global constructor.");
