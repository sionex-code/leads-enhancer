// settings.cjs — simple key/value admin settings backed by the app_settings
// Postgres table (created in migration 0002 / 0004). Uses the same pool()
// accessor as db.cjs and pg.cjs.
"use strict";

const { pool } = require("./pg.cjs");

const now = () => new Date().toISOString();

/**
 * Read a setting by key. Returns `fallback` when the key is absent or the
 * value is null/empty.
 * @param {string} key
 * @param {string} [fallback]
 * @returns {Promise<string>}
 */
async function getSetting(key, fallback = "") {
  const { rows } = await pool().query(
    `SELECT value FROM app_settings WHERE key = $1`,
    [String(key)]
  );
  const val = rows[0]?.value;
  return val != null && val !== "" ? val : fallback;
}

/**
 * Upsert a setting value. Returns the saved value.
 * @param {string} key
 * @param {string} value
 * @returns {Promise<string>}
 */
async function setSetting(key, value) {
  const k = String(key);
  const v = String(value);
  const ts = now();
  await pool().query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [k, v, ts]
  );
  return v;
}

/**
 * Convenience helper: returns the current lead source mode.
 * Values: 'warehouse' (default) | 'warehouse_fallback'
 * @returns {Promise<'warehouse'|'warehouse_fallback'>}
 */
async function getLeadSourceMode() {
  const mode = await getSetting("lead_source_mode", "warehouse");
  if (mode === "warehouse_fallback") return "warehouse_fallback";
  return "warehouse";
}

module.exports = { getSetting, setSetting, getLeadSourceMode };
