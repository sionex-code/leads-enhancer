// Post-`next build` step for the Electron desktop bundle.
//
// Next's standalone output ships server.js + traced node_modules but NOT the
// client assets, so we copy .next/static (and public/, if any) next to it. We
// then rebuild the native better-sqlite3 addon for Electron's Node ABI (it
// differs from the system Node that `next build` used) and materialize the
// external-module symlink store (see materializeExternals) so the bundle is
// self-contained and machine-independent.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

// Robust recursive copy: stat() follows symlinks so a linked module is copied as
// real files; dangling links are skipped.
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    let st;
    try { st = fs.statSync(s); } catch { continue; }
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
  return true;
}

// Turbopack compiles serverExternalPackages to `require('<name>-<hash>')` and
// Next satisfies that by symlinking .next/node_modules/<name>-<hash> to the dev
// machine's absolute node_modules path. Those links would dangle on any other
// machine and point at the wrong (non-Electron) binary, so replace each with a
// real copy of the corresponding (already Electron-rebuilt) module from
// standalone/node_modules.
function materializeExternals() {
  const extDir = path.join(STANDALONE, ".next", "node_modules");
  if (!fs.existsSync(extDir)) return;
  for (const name of fs.readdirSync(extDir)) {
    const linkPath = path.join(extDir, name);
    let lst;
    try { lst = fs.lstatSync(linkPath); } catch { continue; }
    if (!lst.isSymbolicLink()) continue;
    let realName;
    try { realName = path.basename(fs.realpathSync(linkPath)); } catch { realName = name.replace(/-[0-9a-f]{16}$/, ""); }
    const src = path.join(STANDALONE, "node_modules", realName);
    if (!fs.existsSync(src)) {
      console.warn(`Cannot materialize ${name}: ${realName} missing in standalone/node_modules.`);
      continue;
    }
    fs.rmSync(linkPath, { recursive: true, force: true });
    copyDir(src, linkPath);
    console.log(`Materialized .next/node_modules/${name} from ${realName}.`);
  }
}

async function main() {
  if (!fs.existsSync(STANDALONE)) {
    console.error('No .next/standalone. Build with BUILD_STANDALONE=1 next build first.');
    process.exit(1);
  }

  // 0. Prune over-traced files the runtime never needs (they bloat by ~2GB):
  //    - output/  : the dev data dir (CSVs, leads.db, reports). At runtime the
  //                 app uses GMAPS_DATA_DIR (per-user writable) instead.
  //    - node_modules/electron : ~355MB, dragged in by Playwright's optional
  //                 Electron driver support — the server never launches it.
  for (const junk of ["output", path.join("node_modules", "electron")]) {
    const p = path.join(STANDALONE, junk);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      console.log(`Pruned ${junk} from standalone.`);
    }
  }

  // 1. Client assets the standalone server serves at /_next/static and /public.
  copyDir(path.join(ROOT, ".next", "static"), path.join(STANDALONE, ".next", "static"));
  if (copyDir(path.join(ROOT, "public"), path.join(STANDALONE, "public"))) {
    console.log("Copied public/ into standalone.");
  }
  console.log("Copied .next/static into standalone.");

  // 2. Get the native better-sqlite3 binary for the exact runtime the packaged
  //    app uses. The server runs under Electron's utilityProcess, whose ABI is
  //    that of Electron's bundled Node (e.g. Electron 42 = Node 24, ABI 146) —
  //    NOT the system Node that ran the build. Next traces only the .node + JS
  //    into the bundle (no binding.gyp/sources), so we compile in a temp copy of
  //    the FULL top-level better-sqlite3 (leaving the dev install's ABI intact)
  //    and drop the resulting binary into the bundle copy.
  const bsqDest = path.join(STANDALONE, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
  const bsqSrc = path.join(ROOT, "node_modules", "better-sqlite3");
  if (!fs.existsSync(path.join(bsqSrc, "binding.gyp"))) {
    console.warn("Top-level better-sqlite3 sources not found — skipping native build.");
  } else {
    // The packaged server runs under Electron's utilityProcess, which loads native
    // addons with ELECTRON'S module version (Electron overrides NODE_MODULE_VERSION,
    // e.g. 146 for Electron 42 — different from official Node 24's 137). So build
    // against Electron's headers (--runtime=electron --dist-url electron headers).
    const electronVersion = require(path.join(ROOT, "node_modules", "electron", "package.json")).version;

    const tmp = path.join(ROOT, ".next", ".bsq-build");
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`Building better-sqlite3 for Electron ${electronVersion} (Electron ABI)...`);
    copyDir(bsqSrc, tmp);

    const targetArgs = ["--runtime=electron", `--target=${electronVersion}`, "--dist-url=https://electronjs.org/headers", "--arch=x64"];
    // Prefer a prebuilt for that Electron version; fall back to a source compile.
    const prebuildInstall = path.join(ROOT, "node_modules", "prebuild-install", "bin.js");
    let res = spawnSync(process.execPath, [prebuildInstall, ...targetArgs, "--platform=win32"], { cwd: tmp, stdio: "inherit" });
    if (res.status !== 0) {
      console.log("No prebuilt — compiling from source (node-gyp)...");
      const nodeGyp = path.join(ROOT, "node_modules", "node-gyp", "bin", "node-gyp.js");
      res = spawnSync(process.execPath, [nodeGyp, "rebuild", "--release", ...targetArgs], { cwd: tmp, stdio: "inherit" });
      if (res.status !== 0) throw new Error(`Failed to build better-sqlite3 for Electron ${electronVersion} (status ${res.status}). Ensure Python + MSVC build tools are installed.`);
    }

    const built = path.join(tmp, "build", "Release", "better_sqlite3.node");
    if (!fs.existsSync(built)) throw new Error("better-sqlite3 build produced no binary.");
    fs.mkdirSync(path.dirname(bsqDest), { recursive: true });
    fs.copyFileSync(built, bsqDest);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log("Native binary built and placed in the bundle.");
  }

  // 3. Replace the dev-absolute external symlinks with real (rebuilt) copies.
  materializeExternals();

  // 4. Bundle the runner CLI scripts + the raw web/ lib so the scrape → enrich →
  //    whatsapp → audit → report pipeline can be spawned inside the app. They sit
  //    next to standalone/node_modules so `require('patchright')` etc. resolve
  //    normally. (enrich-crawlee needs crawlee, which isn't bundled — the default
  //    patchright enrich engine is fully self-contained.)
  const runnerFiles = [
    "web-runner.cjs", "web-runner.js",
    "scrape.cjs", "scrape.js", "gridscrape.cjs", "gridscrape.js",
    "inpage.cjs", "mapsparse.cjs", "pb-template.json", "bootstrap-pb.js",
    "enrich.cjs", "enrich.js", "enrich-crawlee.js",
    "whatsapp.cjs", "whatsapp.js",
    "analyze.cjs", "analyze.js", "report.cjs", "report.js",
    "project.cjs", "project.js", "merge.cjs", "merge.js",
    "count-emails.cjs", "count-emails.js", "filter-emails.cjs", "filter-emails.js",
  ];
  let copied = 0;
  for (const f of runnerFiles) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(STANDALONE, f)); copied++; }
  }
  copyDir(path.join(ROOT, "web"), path.join(STANDALONE, "web"));
  console.log(`Bundled ${copied} runner scripts + web/ into standalone.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
