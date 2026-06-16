// Packages the Electron desktop app in three steps so electron-builder never
// touches the Next standalone bundle's node_modules (v26 rewrites any node_modules
// it packs into a symlinked store that fails on Windows without admin/dev mode):
//
//   1. electron-builder --dir            → build the unpacked app (Electron + our
//                                          electron/ entry only; no bundle).
//   2. copy .next/standalone             → win-unpacked/resources/standalone
//                                          (verbatim, node_modules intact).
//   3. electron-builder --prepackaged    → build the NSIS installer + portable
//                                          exe straight from the ready dir.
//
// Pass --dir to stop after step 2 (unpacked app only, for quick testing).
//
// During the builder steps package.json "dependencies" is emptied so the builder
// doesn't try to hoist the project's production node_modules into resources/app.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PKG = path.join(ROOT, "package.json");
const STANDALONE = path.join(ROOT, ".next", "standalone");
const OUT_DIR = path.join(ROOT, "dist-electron");
const UNPACKED = path.join(OUT_DIR, "win-unpacked");
const dirOnly = process.argv.includes("--dir");

const builderBin = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");

function builder(args) {
  const res = spawnSync(builderBin, ["--config", "electron-builder.yml", ...args], {
    cwd: ROOT, stdio: "inherit", shell: process.platform === "win32",
  });
  if (res.status !== 0) throw new Error(`electron-builder ${args.join(" ")} failed (${res.status})`);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    // stat (not lstat) so symlinks are followed to their real target.
    let st;
    try { st = fs.statSync(s); } catch { continue; } // skip dangling links
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(path.join(STANDALONE, "server.js"))) {
  console.error('No standalone build. Run "npm run build:standalone" first.');
  process.exit(1);
}

const original = fs.readFileSync(PKG, "utf8");
try {
  const pkg = JSON.parse(original);
  pkg.dependencies = {};
  pkg.main = "electron/main.cjs";
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2));

  // 1. Unpacked app (no bundle yet).
  builder(["--dir"]);

  // 2. Copy the standalone bundle in, verbatim.
  const dest = path.join(UNPACKED, "resources", "standalone");
  fs.rmSync(dest, { recursive: true, force: true });
  console.log("Copying standalone bundle into resources/standalone ...");
  copyDir(STANDALONE, dest);
  console.log("Bundle copied.");

  // 3. Installers from the prepared dir (unless --dir).
  if (!dirOnly) {
    builder(["--prepackaged", UNPACKED]);
  }
} finally {
  fs.writeFileSync(PKG, original);
}

console.log(dirOnly ? "Unpacked app ready at dist-electron/win-unpacked" : "Installers ready in dist-electron/");
