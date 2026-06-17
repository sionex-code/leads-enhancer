// Map-scraper module — public entry point. web-runner imports THIS file for the
// scrape stage; with SCRAPER_WORKER_URL set the whole scrape runs on another VPS.
const { isRemote } = require("../registry.cjs");
const local = require("./local.cjs");
const remote = require("./remote.cjs");

const backend = () => (isRemote("scraper") ? remote : local);

module.exports = {
  runBatch: (ctx) => backend().runBatch(ctx),
  runScrapeToDir: local.runScrapeToDir, // worker-side core (always local on the worker)
  findRawCsv: local.findRawCsv,
};
