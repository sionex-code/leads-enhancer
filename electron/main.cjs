// Electron main process for the Lead Ops desktop app.
//
// It boots the Next.js production server (standalone output) as a forked Node
// process (using Electron's bundled Node via ELECTRON_RUN_AS_NODE), waits for it
// to answer, then loads it in a BrowserWindow. The SQLite DB + scraped output go
// to the per-user writable folder (app.getPath("userData")) via GMAPS_DATA_DIR.
//
// Chrome: the chatbot detector / website audit drive the user's installed Google
// Chrome (patchright channel:"chrome"). If Chrome is missing those features warn
// instead of crashing — the rest of the dashboard works regardless.

const { app, BrowserWindow, shell, dialog, Menu, utilityProcess } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");

let serverProc = null;
let mainWindow = null;
let serverPort = 0;

// The Next standalone bundle: packaged it's copied to resources/standalone
// (extraResources); in dev it's at <project>/.next/standalone.
const STANDALONE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "standalone")
  : path.join(__dirname, "..", ".next", "standalone");

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => {
        res.destroy();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("Server did not start in time"));
        else setTimeout(tick, 400);
      });
      req.on("timeout", () => { req.destroy(); });
    };
    tick();
  });
}

async function startServer() {
  // GMAPS_PORT pins the port (handy for debugging); otherwise pick a free one.
  serverPort = process.env.GMAPS_PORT ? Number(process.env.GMAPS_PORT) : await findFreePort();
  const dataDir = app.getPath("userData");
  fs.mkdirSync(path.join(dataDir, "output"), { recursive: true });

  const serverJs = path.join(STANDALONE_DIR, "server.js");
  if (!fs.existsSync(serverJs)) {
    throw new Error(`Standalone server not found at ${serverJs}. Run "npm run build:standalone" first.`);
  }

  // utilityProcess.fork (not child_process.fork + ELECTRON_RUN_AS_NODE) so the
  // server runs with Electron's native-module ABI — the same ABI that
  // @electron/rebuild compiles better-sqlite3 for. ELECTRON_RUN_AS_NODE would run
  // the bundled vanilla Node instead, whose ABI differs and fails to load it.
  serverProc = utilityProcess.fork(serverJs, [], {
    cwd: STANDALONE_DIR,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(serverPort),
      HOSTNAME: "127.0.0.1",
      GMAPS_DATA_DIR: dataDir,
      // Where the bundled runner scripts (web-runner.js, scrape.js, …) + their
      // node_modules live, so the scraping/enrich/audit pipeline can be spawned.
      GMAPS_APP_ROOT: STANDALONE_DIR,
      // The Electron binary (used as the Node runtime for the spawned runner via
      // ELECTRON_RUN_AS_NODE). process.execPath in the main process is the app exe.
      GMAPS_RUNNER_NODE: process.execPath,
      NEXT_PUBLIC_BASE_PATH: "",
      LEADS_DISABLE_AUTH: "1",
    },
  });
  serverProc.stdout?.on("data", (d) => process.stdout.write(`[next] ${d}`));
  serverProc.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`));
  serverProc.on("exit", (code) => {
    if (code && !app.isQuitting) {
      dialog.showErrorBox("Server stopped", `The app server exited (code ${code}).`);
      app.quit();
    }
  });

  await waitForServer(serverPort);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0b1020",
    title: "Lead Ops",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Open external links (target=_blank) in the system browser, not new windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
  mainWindow.on("closed", () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    { label: "App", submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "quit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Single-instance lock so the DB isn't opened by two app copies at once.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      await startServer();
      createWindow();
    } catch (err) {
      dialog.showErrorBox("Failed to start", String(err.message || err));
      app.quit();
    }
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on("before-quit", () => { app.isQuitting = true; });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("quit", () => { if (serverProc) try { serverProc.kill(); } catch {} });
