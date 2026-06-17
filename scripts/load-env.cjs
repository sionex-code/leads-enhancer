// Minimal .env loader (no dotenv dependency) for CLI/runner contexts where Next's
// built-in env loading isn't available — drizzle-kit, web-runner.cjs, scripts.
// Next.js itself loads .env automatically; this only fills gaps for plain node.
const fs = require("fs");
const path = require("path");

function parseEnvFile(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

// Later files do NOT override already-set vars; load most-specific first.
const root = process.env.GMAPS_APP_ROOT || process.cwd();
for (const name of [".env.local", ".env"]) {
  parseEnvFile(path.join(root, name));
}

module.exports = {};
