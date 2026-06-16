// Generic "ship a CSV stage to a worker" round-trip, shared by the enrich /
// whatsapp / audit remote backends. The batch CLIs are file-based, so to run a
// stage on another VPS we send the input file(s), the worker runs the *same* CLI
// against a temp copy, and returns the output file(s) which we drop back into the
// project dir so downstream stages continue unchanged. The leads DB is shared, so
// realtime upserts still land centrally.
const fs = require("fs");
const path = require("path");
const { postJSON } = require("../client.cjs");

const readB64 = (p) => fs.readFileSync(p).toString("base64");

function writeB64(p, b64) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from(b64, "base64"));
}

// inputs: [{ name, path }] (files to send). destDir: where returned outputs land.
// params: stage knobs forwarded to the worker. Returns the worker's JSON result.
async function runRemoteBatch(name, route, { workerUrl, secret, params, inputs, destDir, log }) {
  const payload = {
    params: params || {},
    inputs: (inputs || []).map((f) => ({ name: f.name, data: readB64(f.path) })),
  };
  if (log) log(`remote ${name}: uploading ${payload.inputs.length} file(s) to worker…`);
  const res = await postJSON(workerUrl, route, payload, { secret });
  for (const out of res.outputs || []) {
    writeB64(path.join(destDir, out.name), out.data);
  }
  if (log) log(`remote ${name}: ${res.message || "done"} (${(res.outputs || []).length} file(s) back)`);
  return res;
}

module.exports = { runRemoteBatch, readB64, writeB64 };
