#!/usr/bin/env node
// Pack the browser extension into public/leadsfunda-extension.zip.
//
// The one thing this exists to guarantee: every entry sits under a single
// top-level `leadsfunda-extension/` folder. A flat zip - which is what a plain
// `zip -r ext.zip *` from inside the source folder produces - spills 10 loose
// items into the user's Downloads when they unzip it, and then "select the
// leadsfunda-extension folder" in the install guide refers to a folder that
// does not exist. Windows' Extract All and macOS' Archive Utility both invent
// a folder and hide the problem; `unzip` on Linux, and any user who extracts
// into an existing folder, do not.
//
// The extension lives outside this repo, so point at it explicitly:
//   node scripts/pack-extension.cjs [source-dir]
//   EXTENSION_DIR=/path/to/ext node scripts/pack-extension.cjs
//
// Default is ../gmaps-lead-extension, which is where it sits beside a checkout.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FOLDER = "leadsfunda-extension";          // must match app/extension/InstallGuide.js
const ZIP = `${FOLDER}.zip`;
const SKIP = new Set([".git", "node_modules", ".DS_Store", "__MACOSX", ".gitignore"]);

const repo = path.join(__dirname, "..");
const source = path.resolve(
  process.argv[2] || process.env.EXTENSION_DIR || path.join(repo, "..", "gmaps-lead-extension")
);
const out = path.join(repo, "public", ZIP);

if (!fs.existsSync(path.join(source, "manifest.json"))) {
  console.error(`No manifest.json in ${source}`);
  console.error("Pass the extension directory: node scripts/pack-extension.cjs <dir>");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));

// Copy into a staging dir named for the folder we want inside the archive, and
// zip *that* - the folder name comes from the directory, so it cannot drift.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "lf-ext-"));
const root = path.join(stage, FOLDER);
fs.cpSync(source, root, {
  recursive: true,
  filter: (src) => !SKIP.has(path.basename(src)),
});

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
execFileSync("zip", ["-q", "-r", "-X", out, FOLDER], { cwd: stage });

// Trust nothing: read the archive back and assert the shape.
const listing = execFileSync("unzip", ["-Z1", out], { encoding: "utf8" })
  .split("\n").map((l) => l.trim()).filter(Boolean);
const stray = listing.filter((e) => !e.startsWith(`${FOLDER}/`) && e !== `${FOLDER}/`);
if (stray.length) {
  console.error(`Entries outside ${FOLDER}/: ${stray.slice(0, 5).join(", ")}`);
  process.exit(1);
}

fs.rmSync(stage, { recursive: true, force: true });
const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`${ZIP}: v${manifest.version}, ${listing.length} entries, ${kb}KB`);
console.log(`every entry under ${FOLDER}/ - unzips to one folder`);
console.log(`\nNot tracked in git. Copy it to the server yourself:`);
console.log(`  scp public/${ZIP} onlano-prod:/www/wwwroot/leadsfunda.com/public/${ZIP}`);
