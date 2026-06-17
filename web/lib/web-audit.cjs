// Fast website audit engine (patchright / stealth Chrome) — replaces Lighthouse.
//
// One page load per audit (~5-20s vs Lighthouse's ~60s). Captures network +
// console while loading, then runs in-page probes and returns a rich JSON report:
//   scores      — 0-100 per category (performance/layout/mobile/seo/security/accessibility/chat) + overall
//   performance — TTFB / FCP / DOMContentLoaded / load / page weight / heaviest assets
//   layout      — horizontal overflow, off-screen elements, broken images, JS/console errors
//   mobile      — viewport meta, tiny fonts, small tap targets
//   chat        — detected live-support widgets (Intercom, Drift, Crisp, ...)
//   seo         — title / description / h1 / canonical / og / favicon / lang
//   security    — https, mixed content, security headers
//   issues[]    — flat, severity-ranked list of everything wrong
//
// `auditUrl(url, { browser })` reuses a shared browser when given one (so callers
// can audit many sites concurrently); otherwise it launches and closes its own.

const { chromium } = require("patchright");

// ---- known live-chat / support widgets ------------------------------------
const CHAT_SIGNATURES = [
  { name: "Intercom",        url: /widget\.intercom\.io|intercomcdn/i,            global: ["Intercom"],          sel: [".intercom-launcher", "#intercom-container"] },
  { name: "Drift",           url: /js\.driftt\.com|drift\.com/i,                  global: ["drift", "driftt"],   sel: ["#drift-widget", ".drift-frame-controller"] },
  { name: "Crisp",           url: /client\.crisp\.chat/i,                         global: ["$crisp", "CRISP_WEBSITE_ID"], sel: [".crisp-client", "#crisp-chatbox"] },
  { name: "Tawk.to",         url: /embed\.tawk\.to/i,                             global: ["Tawk_API"],          sel: ["#tawkchat-container", "iframe[title*='chat' i]"] },
  { name: "Zendesk Chat",    url: /zopim|zdassets|static\.zdassets\.com|widget\.zendesk/i, global: ["$zopim", "zE", "zEmbed"], sel: ["#launcher", ".zopim"] },
  { name: "LiveChat",        url: /cdn\.livechatinc\.com/i,                       global: ["LiveChatWidget", "LC_API"], sel: ["#livechat-compact-container", "#chat-widget-container"] },
  { name: "Tidio",           url: /code\.tidio\.co/i,                             global: ["tidioChatApi"],      sel: ["#tidio-chat"] },
  { name: "HubSpot Chat",    url: /js\.hs-scripts\.com|js\.usemessages\.com/i,    global: ["HubSpotConversations"], sel: ["#hubspot-messages-iframe-container"] },
  { name: "Freshchat",       url: /wchat\.freshchat\.com|fw-cdn\.com/i,           global: ["fcWidget"],          sel: ["#fc_frame", "#freshchat-container"] },
  { name: "Olark",           url: /static\.olark\.com/i,                          global: ["olark"],             sel: ["#olark-wrapper", ".olark-launch-button"] },
  { name: "Facebook Messenger", url: /connect\.facebook\.net\/.*sdk\/xfbml\.customerchat/i, global: ["FB"], sel: [".fb_dialog", ".fb-customerchat"] },
  { name: "WhatsApp",        url: /api\.whatsapp\.com|wa\.me/i,                   global: [],                    sel: ["a[href*='wa.me']", "a[href*='api.whatsapp.com']"] },
  { name: "Gorgias",         url: /config\.gorgias\.chat/i,                       global: ["GorgiasChat"],       sel: ["#gorgias-chat-container"] },
  { name: "Tiledesk",        url: /widget\.tiledesk\.com/i,                       global: ["tiledesk"],          sel: ["#tiledesk-container"] },
  { name: "Chatwoot",        url: /\/packs\/js\/sdk\.js/i,                        global: ["$chatwoot", "chatwootSDK"], sel: [".woot-widget-holder", ".woot--bubble-holder"] },
  { name: "JivoChat",        url: /code\.jivosite\.com/i,                         global: ["jivo_api"],          sel: ["jdiv", "#jvlabelWrap"] },
  { name: "Smartsupp",       url: /smartsuppchat\.com/i,                          global: ["smartsupp"],         sel: ["#smartsupp-widget-container"] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function auditUrl(rawUrl, opts = {}) {
  const {
    headless = true,
    mobile = false,
    timeout = 45000,
    waitAfterLoad = 2000, // let lazy widgets (chat etc.) boot
    browser = null,       // reuse a shared browser for concurrency
  } = opts;

  let url = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const parsed = new URL(url);

  const viewport = mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 };

  // Reuse a passed-in browser; otherwise launch our own (real Chrome channel).
  const ownBrowser = !browser;
  const br = browser || (await chromium.launch({ channel: "chrome", headless, args: ["--disable-dev-shm-usage"] }));

  const context = await br.newContext({
    viewport,
    userAgent: mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();

  const responses = [];
  const failed = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on("response", (res) => {
    try { responses.push({ url: res.url(), status: res.status(), type: res.request().resourceType() }); } catch {}
  });
  page.on("requestfailed", (req) => failed.push({ url: req.url(), type: req.resourceType(), error: req.failure()?.errorText || "failed" }));
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300)); });
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));

  const started = Date.now();
  let navStatus = null;
  let navError = null;
  try {
    const resp = await page.goto(url, { waitUntil: "load", timeout });
    navStatus = resp ? resp.status() : null;
  } catch (e) {
    navError = String(e.message || e).slice(0, 200);
    try { await page.waitForLoadState("domcontentloaded", { timeout: 8000 }); } catch {}
  }
  await sleep(waitAfterLoad);
  const wallMs = Date.now() - started;
  const finalUrl = page.url();

  let probe = {};
  try {
    probe = await page.evaluate((chatSel) => {
      const out = {};
      const nav = performance.getEntriesByType("navigation")[0];
      const paints = performance.getEntriesByType("paint");
      const fcp = paints.find((p) => p.name === "first-contentful-paint");
      out.timing = nav ? {
        ttfb: Math.round(nav.responseStart),
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
        domComplete: Math.round(nav.domComplete),
        load: Math.round(nav.loadEventEnd),
      } : null;
      out.fcp = fcp ? Math.round(fcp.startTime) : null;

      const res = performance.getEntriesByType("resource");
      let totalBytes = 0; const byType = {}; const heavy = [];
      for (const r of res) {
        const bytes = r.transferSize || r.encodedBodySize || 0;
        totalBytes += bytes;
        byType[r.initiatorType] = (byType[r.initiatorType] || 0) + bytes;
        if (bytes > 0) heavy.push({ url: r.name, bytes, type: r.initiatorType });
      }
      heavy.sort((a, b) => b.bytes - a.bytes);
      out.resources = { count: res.length, totalBytes, byType, heaviest: heavy.slice(0, 8) };

      const docW = document.documentElement.clientWidth;
      out.scrollWidth = document.documentElement.scrollWidth;
      out.clientWidth = docW;
      out.horizontalOverflow = document.documentElement.scrollWidth > docW + 2;
      const overflowers = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > docW + 4 || r.left < -4)) {
          const tag = el.tagName.toLowerCase();
          const id = el.id ? "#" + el.id : "";
          const cls = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
          overflowers.push((tag + id + cls).slice(0, 80));
          if (overflowers.length >= 12) break;
        }
      }
      out.overflowElements = [...new Set(overflowers)];

      const imgs = [...document.images];
      out.images = {
        total: imgs.length,
        broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src).slice(0, 15),
        missingAlt: imgs.filter((i) => !i.getAttribute("alt") && i.naturalWidth > 1).length,
      };

      const vp = document.querySelector('meta[name="viewport"]');
      out.viewportMeta = vp ? vp.getAttribute("content") : null;
      let tinyFont = 0, smallTap = 0;
      for (const el of [...document.querySelectorAll("p,span,a,li,td,div")].slice(0, 600)) {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < 12 && el.textContent.trim().length > 3) tinyFont++;
      }
      for (const el of [...document.querySelectorAll("a,button,input,select,[role=button]")].slice(0, 400)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32)) smallTap++;
      }
      out.tinyFontCount = tinyFont;
      out.smallTapCount = smallTap;

      const meta = (sel, attr = "content") => { const e = document.querySelector(sel); return e ? e.getAttribute(attr) : null; };
      out.seo = {
        title: document.title || null,
        titleLength: (document.title || "").length,
        description: meta('meta[name="description"]'),
        h1Count: document.querySelectorAll("h1").length,
        canonical: meta('link[rel="canonical"]', "href"),
        lang: document.documentElement.getAttribute("lang"),
        favicon: !!document.querySelector('link[rel~="icon"]'),
        ogTitle: meta('meta[property="og:title"]'),
        ogImage: meta('meta[property="og:image"]'),
        robotsNoindex: /noindex/i.test(meta('meta[name="robots"]') || ""),
        structuredData: document.querySelectorAll('script[type="application/ld+json"]').length,
      };

      const inputs = [...document.querySelectorAll("input:not([type=hidden]),select,textarea")];
      out.inputsNoLabel = inputs.filter((el) => {
        if (el.getAttribute("aria-label") || el.getAttribute("placeholder")) return false;
        if (el.id && document.querySelector(`label[for="${el.id}"]`)) return false;
        return !el.closest("label");
      }).length;

      const chatHits = [];
      for (const sig of chatSel) {
        let hit = false;
        for (const g of sig.global) { if (typeof window[g] !== "undefined") { hit = true; break; } }
        if (!hit) for (const s of sig.sel) { try { if (document.querySelector(s)) { hit = true; break; } } catch {} }
        if (hit) chatHits.push(sig.name);
      }
      out.chatDom = chatHits;
      out.scripts = document.scripts.length;
      out.iframes = document.querySelectorAll("iframe").length;
      return out;
    }, CHAT_SIGNATURES.map((s) => ({ name: s.name, global: s.global, sel: s.sel })));
  } catch (e) {
    probe = { evalError: String(e.message || e).slice(0, 200) };
  }

  const isHttps = parsed.protocol === "https:";
  const mixedContent = isHttps ? [...new Set(responses.filter((r) => r.url.startsWith("http://")).map((r) => r.url))].slice(0, 15) : [];
  const httpErrors = responses.filter((r) => r.status >= 400).map((r) => ({ url: r.url, status: r.status })).slice(0, 20);

  let secHeaders = {};
  try {
    const apiResp = await context.request.get(finalUrl, { timeout: 15000 }).catch(() => null);
    const h = apiResp ? apiResp.headers() : {};
    secHeaders = {
      hsts: !!h["strict-transport-security"],
      csp: !!h["content-security-policy"],
      xContentType: !!h["x-content-type-options"],
      xFrame: !!h["x-frame-options"],
      server: h["server"] || null,
    };
  } catch {}

  const chatNetwork = CHAT_SIGNATURES.filter((s) => responses.some((r) => s.url.test(r.url))).map((s) => s.name);
  const chatDetected = [...new Set([...(probe.chatDom || []), ...chatNetwork])];

  await context.close().catch(() => {});
  if (ownBrowser) await br.close().catch(() => {});

  // ---- issues + scoring ---------------------------------------------------
  const issues = [];
  const add = (severity, category, message) => issues.push({ severity, category, message });
  const t = probe.timing || {};
  const fcp = probe.fcp;

  if (navError) add("high", "performance", `Page never fully loaded: ${navError}`);
  if (navStatus && navStatus >= 400) add("high", "performance", `Top-level page returned HTTP ${navStatus}`);
  if (fcp != null && fcp > 3000) add("high", "performance", `Slow First Contentful Paint: ${fcp}ms (>3s)`);
  else if (fcp != null && fcp > 1800) add("medium", "performance", `Mediocre First Contentful Paint: ${fcp}ms`);
  if (t.load && t.load > 6000) add("high", "performance", `Slow full load: ${(t.load / 1000).toFixed(1)}s`);
  else if (t.load && t.load > 3500) add("medium", "performance", `Load time ${(t.load / 1000).toFixed(1)}s could be faster`);
  const totalKB = Math.round((probe.resources?.totalBytes || 0) / 1024);
  if (totalKB > 4000) add("high", "performance", `Very heavy page: ${(totalKB / 1024).toFixed(1)}MB transferred`);
  else if (totalKB > 2000) add("medium", "performance", `Heavy page: ${(totalKB / 1024).toFixed(1)}MB transferred`);
  if ((probe.resources?.count || 0) > 120) add("medium", "performance", `${probe.resources.count} network requests (lots of round-trips)`);

  if (probe.horizontalOverflow) add("high", "layout", `Horizontal scroll: content is ${probe.scrollWidth}px wide vs ${probe.clientWidth}px viewport`);
  if (probe.overflowElements?.length) add("medium", "layout", `${probe.overflowElements.length} element(s) overflow the viewport (e.g. ${probe.overflowElements.slice(0, 3).join(", ")})`);
  if (probe.images?.broken?.length) add("high", "layout", `${probe.images.broken.length} broken image(s)`);
  if (failed.length) add("medium", "layout", `${failed.length} request(s) failed to load`);
  if (httpErrors.length) add("medium", "layout", `${httpErrors.length} resource(s) returned 4xx/5xx`);
  if (pageErrors.length) add("medium", "layout", `${pageErrors.length} uncaught JavaScript error(s)`);
  if (consoleErrors.length > 3) add("low", "layout", `${consoleErrors.length} console errors`);

  if (!probe.viewportMeta) add("high", "mobile", "No responsive viewport meta tag (page won't scale on phones)");
  else if (!/width\s*=\s*device-width/i.test(probe.viewportMeta)) add("medium", "mobile", "Viewport meta missing width=device-width");
  if (probe.tinyFontCount > 5) add("medium", "mobile", `${probe.tinyFontCount} text elements with fonts <12px (hard to read on mobile)`);
  if (probe.smallTapCount > 8) add("low", "mobile", `${probe.smallTapCount} tap targets smaller than 32px`);

  if (!chatDetected.length) add("medium", "chat", "No live-chat / support widget detected");

  const seo = probe.seo || {};
  if (!seo.title) add("high", "seo", "Missing <title>");
  else if (seo.titleLength > 65) add("low", "seo", `Title is long (${seo.titleLength} chars)`);
  if (!seo.description) add("medium", "seo", "Missing meta description");
  if (seo.h1Count === 0) add("medium", "seo", "No <h1> heading");
  else if (seo.h1Count > 1) add("low", "seo", `${seo.h1Count} <h1> tags (should usually be one)`);
  if (!seo.canonical) add("low", "seo", "No canonical link");
  if (!seo.favicon) add("low", "seo", "No favicon");
  if (!seo.lang) add("low", "seo", "<html> has no lang attribute");
  if (seo.robotsNoindex) add("high", "seo", "Page is set to noindex (won't appear in search)");
  if (!seo.ogTitle) add("low", "seo", "No Open Graph tags (poor social sharing previews)");

  if (probe.images?.missingAlt > 0) add("low", "accessibility", `${probe.images.missingAlt} image(s) missing alt text`);
  if (probe.inputsNoLabel > 0) add("low", "accessibility", `${probe.inputsNoLabel} form field(s) without a label`);

  if (!isHttps) add("high", "security", "Site not served over HTTPS");
  if (mixedContent.length) add("high", "security", `${mixedContent.length} insecure (http://) resource(s) on an HTTPS page`);
  if (isHttps && !secHeaders.hsts) add("low", "security", "No HSTS header");
  if (!secHeaders.csp) add("low", "security", "No Content-Security-Policy header");

  const weight = { high: 15, medium: 6, low: 2 };
  const catScore = (cat) => {
    let s = 100;
    for (const i of issues.filter((i) => i.category === cat)) s -= weight[i.severity];
    return Math.max(0, Math.min(100, s));
  };
  let overall = 100;
  for (const i of issues) overall -= weight[i.severity];
  overall = Math.max(0, Math.min(100, overall));
  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    url: finalUrl,
    requestedUrl: url,
    redirected: finalUrl !== url,
    fetchedAt: new Date().toISOString(),
    mode: mobile ? "mobile" : "desktop",
    score: overall,
    scores: {
      performance: catScore("performance"),
      layout: catScore("layout"),
      mobile: catScore("mobile"),
      seo: catScore("seo"),
      security: catScore("security"),
      accessibility: catScore("accessibility"),
      chat: catScore("chat"),
    },
    performance: {
      ttfbMs: t.ttfb ?? null,
      fcpMs: fcp,
      domContentLoadedMs: t.domContentLoaded ?? null,
      loadMs: t.load ?? null,
      wallClockMs: wallMs,
      totalTransferKB: totalKB,
      requestCount: probe.resources?.count ?? 0,
      heaviestResources: (probe.resources?.heaviest ?? []).map((r) => ({ url: r.url, kb: Math.round(r.bytes / 1024), type: r.type })),
      httpStatus: navStatus,
    },
    layout: {
      horizontalOverflow: !!probe.horizontalOverflow,
      scrollWidth: probe.scrollWidth ?? null,
      viewportWidth: probe.clientWidth ?? null,
      overflowElements: probe.overflowElements ?? [],
      brokenImages: probe.images?.broken ?? [],
      failedRequests: failed.slice(0, 15),
      httpErrors,
      jsErrors: pageErrors,
      consoleErrors: consoleErrors.slice(0, 15),
      iframes: probe.iframes ?? 0,
      scripts: probe.scripts ?? 0,
    },
    mobileChecks: {
      viewportMeta: probe.viewportMeta ?? null,
      tinyFontElements: probe.tinyFontCount ?? 0,
      smallTapTargets: probe.smallTapCount ?? 0,
    },
    chat: { hasSupportChat: chatDetected.length > 0, providers: chatDetected },
    seo,
    security: { https: isHttps, mixedContent, headers: secHeaders },
    accessibility: {
      imagesMissingAlt: probe.images?.missingAlt ?? 0,
      inputsWithoutLabel: probe.inputsNoLabel ?? 0,
    },
    issues,
    summary: {
      total: issues.length,
      high: issues.filter((i) => i.severity === "high").length,
      medium: issues.filter((i) => i.severity === "medium").length,
      low: issues.filter((i) => i.severity === "low").length,
    },
  };
}

// ---- standalone per-site HTML (used by analyze.cjs `reportHtml`) -----------
function scoreColor(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "#64748b";
  if (n >= 90) return "#22c55e";
  if (n >= 50) return "#f59e0b";
  return "#ef4444";
}

function renderAuditHtml(report) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sevColor = { high: "#ef4444", medium: "#f59e0b", low: "#64748b" };
  const p = report.performance || {};
  const donut = (label, v) =>
    `<div class="d"><div class="ring" style="background:conic-gradient(${scoreColor(v)} ${Math.round((Number(v) || 0) * 3.6)}deg,#1e2742 0)"><span>${Number.isFinite(Number(v)) ? v : "—"}</span></div><label>${esc(label)}</label></div>`;
  const issuesHtml = (report.issues || [])
    .map((i) => `<li><span class="sev" style="background:${sevColor[i.severity]}">${i.severity}</span> <b>${esc(i.category)}</b> — ${esc(i.message)}</li>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit — ${esc(report.url)}</title><style>
:root{color-scheme:dark}body{margin:0;background:#0b0f1d;color:#e6eaf5;font:15px/1.6 system-ui,sans-serif}
.wrap{max-width:880px;margin:0 auto;padding:36px 22px 70px}
h1{font-size:20px;margin:0 0 4px}.sub{color:#7c8db5;font-size:13px;word-break:break-all}
.score{font-size:54px;font-weight:800;margin:18px 0;color:${scoreColor(report.score)}}
.donuts{display:flex;flex-wrap:wrap;gap:18px;margin:14px 0 24px}.d{text-align:center}
.ring{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.ring span{width:48px;height:48px;border-radius:50%;background:#0b0f1d;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
.d label{display:block;margin-top:6px;font-size:11px;color:#8fa0c8;text-transform:capitalize}
.card{background:#121830;border:1px solid #232c4a;border-radius:14px;padding:18px 20px;margin-bottom:16px}
.card h2{font-size:15px;margin:0 0 12px;color:#c3cdf0}
.kv{display:grid;grid-template-columns:200px 1fr;gap:6px 12px;font-size:14px}.kv dt{color:#8fa0c8}.kv dd{margin:0}
ul.issues{list-style:none;padding:0;margin:0}ul.issues li{padding:7px 0;border-bottom:1px solid #1e2742;font-size:14px}
.sev{display:inline-block;min-width:54px;text-align:center;border-radius:6px;color:#0b0f1d;font-weight:700;font-size:11px;padding:2px 6px;text-transform:uppercase;margin-right:6px}
pre{background:#0d1117;color:#9fb0e0;padding:14px;border-radius:10px;overflow:auto;max-height:60vh;font-size:12px}
</style></head><body><div class="wrap">
<h1>${esc(report.url)}</h1><div class="sub">${esc(report.mode)} · ${esc(report.fetchedAt)}</div>
<div class="score">${report.score}<span style="font-size:20px;color:#64748b">/100</span></div>
<div class="donuts">${["performance","layout","mobile","seo","security","accessibility"].map((k) => donut(k, report.scores?.[k])).join("")}</div>
<div class="card"><h2>Key metrics</h2><dl class="kv">
<dt>TTFB</dt><dd>${p.ttfbMs ?? "—"} ms</dd>
<dt>First Contentful Paint</dt><dd>${p.fcpMs ?? "—"} ms</dd>
<dt>Full load</dt><dd>${p.loadMs ?? "—"} ms</dd>
<dt>Page weight</dt><dd>${p.totalTransferKB ?? "—"} KB</dd>
<dt>Requests</dt><dd>${p.requestCount ?? "—"}</dd>
<dt>Support chat</dt><dd>${report.chat?.hasSupportChat ? esc(report.chat.providers.join(", ")) : "none detected"}</dd>
</dl></div>
<div class="card"><h2>Issues (${report.summary?.total || 0})</h2><ul class="issues">${issuesHtml || "<li>No issues found 🎉</li>"}</ul></div>
<div class="card"><h2>Raw report</h2><pre>${esc(JSON.stringify(report, null, 2))}</pre></div>
</div></body></html>`;
}

module.exports = { auditUrl, renderAuditHtml, CHAT_SIGNATURES };
