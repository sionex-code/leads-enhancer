// Small helper for the in-app notification center (job done/failed, quota, etc.).
const { pool } = require("./pg.cjs");

async function list(userId, { unreadOnly = false, limit = 30 } = {}) {
  const where = unreadOnly ? "AND read_at IS NULL" : "";
  const { rows } = await pool().query(
    `SELECT id, type, payload, read_at, created_at FROM notifications
      WHERE user_id = $1 ${where} ORDER BY id DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function unreadCount(userId) {
  const { rows } = await pool().query(
    `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return rows[0].c;
}

async function markRead(userId, ids) {
  if (Array.isArray(ids) && ids.length) {
    await pool().query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2)`,
      [userId, ids]
    );
  } else {
    await pool().query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
  }
}

module.exports = { list, unreadCount, markRead };
