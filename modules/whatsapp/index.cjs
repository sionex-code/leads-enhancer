// WhatsApp-checker module — public entry point. Call sites import THIS file so the
// backend can be swapped local↔remote via WHATSAPP_WORKER_URL. The pure phone
// helpers (normalizePhone / dialingCode) always resolve locally — no need to call a
// worker to format a number.
const { isRemote } = require("../registry.cjs");
const local = require("./local.cjs");
const remote = require("./remote.cjs");

const backend = () => (isRemote("whatsapp") ? remote : local);

module.exports = {
  checkNumber: (number) => backend().checkNumber(number),
  runBatch: (ctx) => backend().runBatch(ctx),
  normalizePhone: local.normalizePhone,
  dialingCode: local.dialingCode,
  runFile: local.runFile,
};
