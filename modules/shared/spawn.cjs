// Shared process-spawning helpers used by every module's local backend (and by
// web-runner, before the modules existed, this lived inline there). Kept tiny and
// dependency-free: spawn a child, stream its output to a log file, resolve on a
// clean exit. The per-stage `setStage` bookkeeping is wrapped here too so each
// module's local.cjs stays focused on *which* command to run, not the plumbing.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Does `cmd` exist anywhere on PATH? (used to detect xvfb-run on Linux hosts)
function commandExists(cmd) {
  const paths = (process.env.PATH || "").split(path.delimiter);
  return paths.some((p) => fs.existsSync(path.join(p, cmd)));
}

function appendTo(file, chunk) {
  fs.appendFileSync(file, chunk.toString(), "utf8");
}

// Spawn a child process, tee stdout+stderr into `logFile`, resolve on exit 0,
// reject otherwise. `options.command` overrides the executable (default: node);
// `options.cwd` the working dir; `options.label` the header line written to the log.
function runProcess(stage, logFile, args, options = {}) {
  return new Promise((resolve, reject) => {
    fs.appendFileSync(logFile, `\n$ ${options.label || [process.execPath, ...args].join(" ")}\n`, "utf8");
    const child = spawn(options.command || process.execPath, args, {
      cwd: options.cwd || process.cwd(),
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: "0", ...(options.env || {}) },
    });
    child.stdout.on("data", (d) => appendTo(logFile, d));
    child.stderr.on("data", (d) => appendTo(logFile, d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${stage} exited with code ${code}`))));
  });
}

// Run one of the repo's CLI scripts as a project stage: flip the project's stage
// state to running, execute `node <ROOT/script> ...args`, then mark it done.
// `ctx` carries { ROOT, dir, store } (see modules/<name>/local.cjs).
async function runNodeStage(ctx, stage, script, stageLog, args) {
  ctx.store.setStage(ctx.dir, stage, { status: "running", startedAt: new Date().toISOString(), error: "" });
  await runProcess(stage, stageLog, [path.join(ctx.ROOT, script), ...args], { cwd: ctx.ROOT });
  ctx.store.setStage(ctx.dir, stage, { status: "done", finishedAt: new Date().toISOString() });
}

module.exports = { commandExists, appendTo, runProcess, runNodeStage };
