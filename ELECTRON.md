# Lead Ops — Desktop app (Electron)

Wraps the Next.js dashboard in a standalone Windows app. The dashboard, leads
SQLite DB, scraping/enrichment, website-status checks and the chatbot detector
all run locally inside the app — no server, no login.

## Build a distributable

```bash
npm run dist        # → dist-electron/Lead Ops-<ver>-x64.exe  (NSIS installer)
                    #   dist-electron/Lead Ops-<ver>-portable.exe (single-file)
npm run dist:dir    # unpacked app only (dist-electron/win-unpacked) for testing
npm run electron    # run the app against the local build (after build:standalone)
```

Either `.exe` runs on any Windows 10/11 x64 machine. User data (the leads DB,
CSV exports, generated reports) is stored per-user under
`%APPDATA%/Lead Ops/output`, so updates never wipe data.

## Requirements for end users

- **Google Chrome installed.** The chatbot detector and the website audit drive
  the user's own Chrome (patchright `channel: "chrome"`). Without Chrome those
  two features fail gracefully; everything else (leads, status checks, enrich,
  WhatsApp, reports list, CSV export) works regardless.
- **Ollama is optional.** The chatbot detector's semantic fallback layer only
  runs if a local Ollama server is reachable on `localhost:11434`; otherwise the
  verdict is based on the network + DOM signal layers alone.

## How packaging works (notes for maintainers)

The pipeline is fiddly because of native modules + Next standalone; the scripts
encapsulate the workarounds:

- `scripts/prepare-standalone.cjs` (after `BUILD_STANDALONE=1 next build`):
  - prunes the over-traced `output/` data dir and `node_modules/electron` (~2GB),
  - copies `.next/static` into the standalone bundle,
  - builds `better-sqlite3` for **Electron's ABI** via a prebuilt (or a source
    compile) — Electron overrides `NODE_MODULE_VERSION`, so it must match the
    Electron version, not the system Node,
  - materializes Next's `.next/node_modules` external-package symlinks (which
    point at absolute dev paths) into real copies.
- `scripts/pack-electron.cjs`: builds the unpacked app with empty `dependencies`
  (so electron-builder doesn't mangle `node_modules` with its symlink dedup),
  copies the standalone bundle into `resources/standalone`, then builds the
  installers from the prepared dir with `--prepackaged`.
- `electron/main.cjs`: launches the standalone server with
  `utilityProcess.fork` (Electron-ABI native modules) on a free port, points the
  DB at `app.getPath("userData")` via `GMAPS_DATA_DIR`, disables the basic-auth
  gate (`LEADS_DISABLE_AUTH=1`), and loads it in a `BrowserWindow`.

**Electron version is pinned to 41.x on purpose**: better-sqlite3 12.10 ships a
prebuilt for Electron 41's ABI (145) but rolled back Electron 42 (ABI 146), and
its C++ doesn't compile against Electron 42's V8. Bumping Electron requires a
better-sqlite3 that supports that ABI.
