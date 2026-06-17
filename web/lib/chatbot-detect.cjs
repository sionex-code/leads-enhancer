// Chatbot detector — ported from the standalone ../chatbot-detector/detect.js
// into a reusable module so the dashboard (and the Electron build) can run it
// without a sibling project. Reuses the app's own `patchright` dependency.
//
//   Layer 0: Network request interception (catches obfuscated / shadow widgets)
//   Layer 1: Pattern matching (scripts, iframes, globals, DOM, shadow DOM, aria)
//   Layer 2: Ollama embedding fallback — OPTIONAL. Only runs if Layers 0+1 find
//            nothing AND a local Ollama server is reachable. If Ollama is not
//            installed/running the layer is skipped silently and the verdict is
//            based on Layers 0+1 alone.
//
// detectChatbot(url, opts) resolves to:
//   { hasChatbot, method, vendors, hits, embedding, httpStatus, httpStatusText }

const { chromium } = require("patchright");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.OLLAMA_EMBED_MODEL || "embeddinggemma";
const EMBED_THRESHOLD = 0.16;

const NETWORK_PATTERNS = [
  [/tawk\.to/i, "Tawk.to"], [/tidio\.com/i, "Tidio"], [/intercom\.io|intercomcdn/i, "Intercom"],
  [/drift\.com|driftt\.com/i, "Drift"], [/crisp\.chat/i, "Crisp"], [/freshchat|freshworks/i, "Freshchat"],
  [/zopim|zendesk\.com.*chat/i, "Zendesk Chat"], [/livechatinc|livechat\.com/i, "LiveChat"],
  [/smartsupp\.com/i, "Smartsupp"], [/olark\.com/i, "Olark"], [/purechat\.com/i, "Pure Chat"],
  [/hubspot\.com.*message|hs-scripts/i, "HubSpot Chat"], [/chatlio\.com/i, "Chatlio"], [/chatra\.io/i, "Chatra"],
  [/gorgias\.com/i, "Gorgias"], [/botpress\.com/i, "Botpress"], [/landbot\.io/i, "Landbot"],
  [/manychat\.com/i, "ManyChat"], [/collect\.chat/i, "Collect.chat"], [/kommunicate\.io/i, "Kommunicate"],
  [/helpcrunch\.com/i, "HelpCrunch"], [/userlike\.com/i, "Userlike"], [/liveagent\.com/i, "LiveAgent"],
  [/salesiq|zoho\.com.*chat/i, "Zoho SalesIQ"], [/chaport\.com/i, "Chaport"], [/jivosite\.com|jivochat/i, "JivoChat"],
  [/snapengage\.com/i, "SnapEngage"], [/liveperson\.net/i, "LivePerson"], [/boldchat\.com/i, "BoldChat"],
  [/clickdesk\.com/i, "ClickDesk"], [/providesupport\.com/i, "Provide Support"], [/chatbase\.co/i, "Chatbase"],
  [/voiceflow\.com/i, "Voiceflow"], [/ada\.support|ada\.cx/i, "Ada"], [/kustomer\.com/i, "Kustomer"],
  [/gladly\.com/i, "Gladly"], [/reamaze\.com/i, "Re:amaze"], [/helpscout\.net/i, "Help Scout"],
  [/customerly\.io/i, "Customerly"], [/kayako\.com/i, "Kayako"], [/happyfox\.com/i, "HappyFox Chat"],
  [/respond\.io/i, "Respond.io"], [/chatfuel\.com/i, "Chatfuel"], [/wati\.io/i, "WATI"],
  [/smartloop\.ai/i, "Smartloop"], [/engati\.com/i, "Engati"], [/rasa\.io|rasa\.com/i, "Rasa"],
  [/dialogflow|googleapis.*agent/i, "Dialogflow"], [/chat\.openai\.com|api\.openai/i, "OpenAI Chat"],
  [/api\.anthropic\.com/i, "Anthropic/Claude Chat"], [/widget\.customerly/i, "Customerly"],
  [/app\.gorgias/i, "Gorgias"], [/widget\.solvvy/i, "Solvvy"], [/cdn\.chatbot\.com/i, "Chatbot.com"],
  [/widget\.usebutton/i, "Button"], [/helpshift\.com/i, "Helpshift"], [/chat\.document360/i, "Document360"],
  [/cdn\.socialintents/i, "Social Intents"], [/app\.acquire\.io/i, "Acquire"], [/chat\.netlify\.app/i, "Netlify Chat"],
  [/socket\.io.*chat|chat.*socket\.io/i, "Custom socket chat"],
  [/[/.]chat[/.]|\/chatbot|\/livechat|\/messenger/i, "Generic chat endpoint"],
];

const SCRIPT_PATTERNS = [
  [/tawk\.to/i, "Tawk.to"], [/tidio/i, "Tidio"], [/intercom/i, "Intercom"], [/drift\.com|js\.driftt\.com/i, "Drift"],
  [/crisp\.chat/i, "Crisp"], [/freshchat|freshworks/i, "Freshchat"], [/zopim|zendesk/i, "Zendesk Chat"],
  [/livechatinc|livechat\.com/i, "LiveChat"], [/smartsupp/i, "Smartsupp"], [/olark/i, "Olark"], [/purechat/i, "Pure Chat"],
  [/hubspot.*message|js\.hs-scripts/i, "HubSpot Chat"], [/chatlio/i, "Chatlio"], [/chatra/i, "Chatra"], [/gorgias/i, "Gorgias"],
  [/botpress/i, "Botpress"], [/landbot/i, "Landbot"], [/manychat/i, "ManyChat"], [/collect\.chat/i, "Collect.chat"],
  [/kommunicate/i, "Kommunicate"], [/helpcrunch/i, "HelpCrunch"], [/re\.clevio/i, "Clevio"], [/engati/i, "Engati"],
  [/userlike/i, "Userlike"], [/liveagent/i, "LiveAgent"], [/salesiq|zoho.*chat/i, "Zoho SalesIQ"], [/chaport/i, "Chaport"],
  [/jivochat|jivosite/i, "JivoChat"], [/snapengage/i, "SnapEngage"], [/liveperson/i, "LivePerson"], [/boldchat/i, "BoldChat"],
  [/velaro/i, "Velaro"], [/clickdesk/i, "ClickDesk"], [/providesupport/i, "Provide Support"], [/chatbase/i, "Chatbase"],
  [/voiceflow/i, "Voiceflow"], [/dialogflow/i, "Dialogflow"], [/ada\.cx|adadigital/i, "Ada"], [/kustomer/i, "Kustomer"],
  [/gladly/i, "Gladly"], [/reamaze/i, "Re:amaze"], [/helpscout/i, "Help Scout"], [/customerly/i, "Customerly"],
  [/kayako/i, "Kayako"], [/happyfox/i, "HappyFox Chat"], [/respond\.io/i, "Respond.io"], [/chatfuel/i, "Chatfuel"],
  [/mobilemonkey/i, "MobileMonkey"], [/wati\.io/i, "WATI"], [/helpshift/i, "Helpshift"], [/chatbot\.com/i, "Chatbot.com"],
  [/socialintents/i, "Social Intents"], [/acquire\.io/i, "Acquire"],
];

const IFRAME_PATTERNS = [
  [/tawk\.to/i, "Tawk.to"], [/tidio/i, "Tidio"], [/intercom/i, "Intercom"], [/drift/i, "Drift"], [/crisp/i, "Crisp"],
  [/freshchat/i, "Freshchat"], [/zendesk/i, "Zendesk"], [/livechat/i, "LiveChat"], [/chat/i, "Chat iframe"],
  [/messenger/i, "Messenger widget"], [/whatsapp/i, "WhatsApp widget"], [/bot/i, "Bot iframe"],
];

const GLOBAL_PATTERNS = [
  [/^Tawk_API$/, "Tawk.to"], [/^Intercom$/, "Intercom"], [/^drift$/, "Drift"], [/^zE$|^zESettings$/, "Zendesk"],
  [/^tidioIdentify$|^tidioChatApi$/, "Tidio"], [/^\$crisp$|^CRISP_WEBSITE_ID$/, "Crisp"], [/^fcWidget$/, "Freshchat"],
  [/^LC_API$|^LiveChatWidget$/, "LiveChat"], [/^HubSpotConversations$/, "HubSpot Chat"], [/^botpressWebChat$/, "Botpress"],
  [/^SmartSupp$/, "Smartsupp"], [/^olark$/, "Olark"], [/^chatra$/, "Chatra"], [/^userlike$/, "Userlike"],
  [/^jivo_api$|^jvlabelWidget$/, "JivoChat"], [/^SnapABug$/, "SnapEngage"], [/^lpTag$/, "LivePerson"],
  [/^ada_settings$|^adaEmbed$/, "Ada"], [/^kustomer$/, "Kustomer"], [/^voiceflow$/, "Voiceflow"],
  [/^kommunicate$/, "Kommunicate"], [/^chaport$/, "Chaport"], [/^chatbase$/, "Chatbase"], [/^Helpshift$/, "Helpshift"],
];

const DOM_ID_CLASS_PATTERNS = [
  [/tawk/i, "Tawk.to"], [/tidio/i, "Tidio"], [/intercom/i, "Intercom"], [/drift/i, "Drift"], [/crisp/i, "Crisp"],
  [/freshchat/i, "Freshchat"], [/zendesk|zopim/i, "Zendesk"], [/livechat/i, "LiveChat"], [/smartsupp/i, "Smartsupp"],
  [/olark/i, "Olark"], [/jivo|jivosite/i, "JivoChat"], [/chaport/i, "Chaport"], [/helpcrunch/i, "HelpCrunch"],
  [/kommunicate/i, "Kommunicate"], [/botpress/i, "Botpress"], [/voiceflow/i, "Voiceflow"], [/chatbase/i, "Chatbase"],
  [/helpshift/i, "Helpshift"],
  [/chat.?widget|chat.?bubble|chat.?button|chat.?launcher|chat.?icon|chat.?toggle/i, "Chat widget"],
  [/live.?chat/i, "Live chat"], [/support.?chat/i, "Support chat"],
  [/messenger.?bubble|fb.?messenger/i, "Messenger bubble"], [/whatsapp.?widget|wa.?widget/i, "WhatsApp widget"],
  [/ada.?button|ada.?chat/i, "Ada"],
];

const ARIA_TEXT_PATTERNS = [
  [/\bchat\s*(with|to|now|us|bot|ai|assistant)?\b/i, "Chat element"], [/\blive\s*chat\b/i, "Live chat"],
  [/\bvirtual\s*assistant\b/i, "Virtual assistant"], [/\bai\s*(chat|assistant|bot)\b/i, "AI chatbot"],
  [/\bchatbot\b/i, "Chatbot"], [/\bmessage\s*us\b/i, "Message us"],
  [/\btalk\s*(to\s*)?(us|support|agent)\b/i, "Talk to us"], [/\bsupport\s*(chat|widget)\b/i, "Support chat"],
  [/\bask\s*(me|us|a\s*question)\b/i, "Ask us"], [/\bstart\s*a?\s*(conversation|chat)\b/i, "Start conversation"],
  [/\bopen\s*(chat|messenger|widget)\b/i, "Open chat"], [/\bhelp\s*(chat|widget|center)\b/i, "Help chat"],
  [/\bwhatsapp\b/i, "WhatsApp"], [/\bmessenger\b/i, "Messenger"],
];

const s = (arr) => arr.map(([r, n]) => [r.source, r.flags, n]);

function buildDomScan(scriptP, iframeP, globalP, domP, ariaP) {
  return `() => {
    const hits = [];
    function allElements(root) {
      const out = [];
      const walk = (node) => { for (const el of node.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
      walk(root); return out;
    }
    const ALL = allElements(document);
    const scriptSrcs = ALL.filter(e => e.tagName==='SCRIPT' && e.src).map(e => e.src);
    const SP = ${JSON.stringify(scriptP)};
    for (const [src,flags,name] of SP) { const m = scriptSrcs.find(s => new RegExp(src,flags).test(s)); if (m) hits.push({ layer:'script', vendor:name, signal:m.slice(0,120) }); }
    const inline = ALL.filter(e => e.tagName==='SCRIPT' && !e.src).map(e => e.textContent).join('\\n');
    const GP = ${JSON.stringify(globalP)};
    for (const [src,flags,name] of GP) { if (new RegExp(src,flags).test(inline) && !hits.find(h=>h.vendor===name)) hits.push({ layer:'inline-script', vendor:name, signal:'inline script' }); }
    const winKeys = Object.keys(window).join('\\n');
    for (const [src,flags,name] of GP) { if (new RegExp(src,flags).test(winKeys) && !hits.find(h=>h.vendor===name)) hits.push({ layer:'global', vendor:name, signal:'window.'+name }); }
    const iframeSrcs = ALL.filter(e => e.tagName==='IFRAME').map(e => e.src||'');
    const IP = ${JSON.stringify(iframeP)};
    for (const [src,flags,name] of IP) { const m = iframeSrcs.find(s => s && new RegExp(src,flags).test(s)); if (m) hits.push({ layer:'iframe', vendor:name, signal:m.slice(0,120) }); }
    const allAttrs = ALL.map(el => (el.id+' '+el.className).trim()).join(' ');
    const DP = ${JSON.stringify(domP)};
    for (const [src,flags,name] of DP) { if (new RegExp(src,flags).test(allAttrs) && !hits.find(h=>h.vendor===name)) hits.push({ layer:'dom-class/id', vendor:name, signal:'id/class match' }); }
    const AP = ${JSON.stringify(ariaP)};
    for (const el of ALL) {
      const text = [el.getAttribute?.('aria-label'), el.getAttribute?.('title'), el.getAttribute?.('alt'), el.getAttribute?.('placeholder')].filter(Boolean).join(' ');
      if (!text) continue;
      for (const [src,flags,name] of AP) { if (new RegExp(src,flags).test(text) && !hits.find(h=>h.signal===text.trim())) { hits.push({ layer:'aria/title', vendor:name, signal:text.trim().slice(0,100) }); break; } }
    }
    const CHAT = /\\b(chat|live chat|chatbot|talk to us|message us|ask us|virtual assistant|ai assistant|ai chat)\\b/i;
    for (const el of ALL.filter(e => /^(BUTTON|A)$/.test(e.tagName) || e.getAttribute?.('role')==='button')) {
      const text = (el.innerText||el.textContent||'').trim();
      if (text && CHAT.test(text)) { const r = el.getBoundingClientRect?.(); if (r && r.width>0 && r.height>0) hits.push({ layer:'button-text', vendor:'Chat button', signal:text.slice(0,80) }); }
    }
    return hits;
  }`;
}

const CHATBOT_PHRASES = [
  "live chat support", "chat with us now", "chatbot virtual assistant", "message us chat widget",
  "talk to support agent", "AI chat help assistant", "open chat bubble", "start conversation bot",
  "customer support chat online", "help desk chat",
];

// Quick probe: is a local Ollama server reachable? Short timeout so a missing
// Ollama never stalls a scan — on failure we just skip the embedding layer.
async function ollamaAvailable() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function getEmbedding(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama: ${res.status}`);
  return (await res.json()).embedding;
}

function cosine(a, b) {
  let dot = 0, mA = 0, mB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; mA += a[i] * a[i]; mB += b[i] * b[i]; }
  return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

async function extractLabels(page) {
  return page.evaluate(() => {
    function allElements(root) {
      const out = [];
      const walk = (node) => { for (const el of node.querySelectorAll("*")) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } };
      walk(root); return out;
    }
    const seen = new Set(), labels = [];
    const add = (t) => { t = (t || "").replace(/\s+/g, " ").trim(); if (t.length > 1 && t.length < 300 && !seen.has(t)) { seen.add(t); labels.push(t); } };
    const vis = (el) => { try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch { return false; } };
    for (const el of allElements(document)) {
      if (vis(el)) {
        add(el.getAttribute?.("aria-label")); add(el.getAttribute?.("placeholder")); add(el.getAttribute?.("title"));
        if (/^(BUTTON|A|LABEL|H1|H2|H3|H4|P|SPAN|LI)$/.test(el.tagName)) add(el.innerText);
      }
    }
    return labels.slice(0, 100);
  });
}

async function embeddingFallback(page) {
  const labels = await extractLabels(page);
  if (labels.length === 0) return { hit: false, score: 0, phrase: "n/a" };
  const pageEmb = await getEmbedding(labels.join(". "));
  let maxSim = -1, bestPhrase = "";
  for (const phrase of CHATBOT_PHRASES) {
    const sim = cosine(pageEmb, await getEmbedding(phrase));
    if (sim > maxSim) { maxSim = sim; bestPhrase = phrase; }
  }
  return { hit: maxSim >= EMBED_THRESHOLD, score: maxSim, phrase: bestPhrase };
}

/**
 * Detect a chatbot/live-chat widget on a URL.
 * @param {string} url
 * @param {object} [opts]
 * @param {import('patchright').Browser} [opts.browser] reuse a shared browser; otherwise one is launched & closed
 * @param {number} [opts.timeoutMs] navigation timeout (default 30000)
 * @param {number} [opts.waitMs] post-load wait for lazy widgets (default 6000)
 * @param {boolean} [opts.useOllama] allow the embedding fallback (default true; auto-skipped if Ollama is down)
 */
async function detectChatbot(url, opts = {}) {
  const { timeoutMs = 30000, waitMs = 6000, useOllama = true } = opts;
  let browser = opts.browser;
  const ownBrowser = !browser;
  if (!browser) {
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-dev-shm-usage"] });
  }
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const networkHits = [];
  page.on("request", (req) => {
    const reqUrl = req.url();
    for (const [pattern, name] of NETWORK_PATTERNS) {
      if (pattern.test(reqUrl) && !networkHits.find((h) => h.vendor === name)) {
        networkHits.push({ layer: "network", vendor: name, signal: reqUrl.slice(0, 120) });
      }
    }
  });

  let httpStatus = 0, httpStatusText = "";
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (resp) { httpStatus = resp.status(); httpStatusText = resp.statusText() || ""; }
  } catch (e) {
    httpStatusText = String(e.message || e).split("\n")[0].slice(0, 120);
  }

  await page.waitForTimeout(waitMs);

  const domFn = buildDomScan(s(SCRIPT_PATTERNS), s(IFRAME_PATTERNS), s(GLOBAL_PATTERNS), s(DOM_ID_CLASS_PATTERNS), s(ARIA_TEXT_PATTERNS));
  let rawHits = [];
  try {
    rawHits = await page.evaluate(eval(domFn));
  } catch { /* page may have failed to load */ }

  const seenKey = new Set();
  const domHits = rawHits.filter((h) => {
    const k = h.vendor + "|" + h.layer;
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });

  const patternHits = [...networkHits, ...domHits];

  let result;
  if (patternHits.length > 0) {
    result = {
      hasChatbot: true,
      method: patternHits[0].layer === "network" ? "network-intercept" : "dom-pattern",
      vendors: [...new Set(patternHits.map((h) => h.vendor))],
      hits: patternHits,
      embedding: null,
    };
  } else if (useOllama && (await ollamaAvailable())) {
    const emb = await embeddingFallback(page);
    result = {
      hasChatbot: emb.hit,
      method: "embedding",
      vendors: emb.hit ? [`Semantic: "${emb.phrase}"`] : [],
      hits: [],
      embedding: emb,
    };
  } else {
    // No pattern match and no Ollama → confident "no chatbot" on signals alone.
    result = { hasChatbot: false, method: "pattern-only", vendors: [], hits: [], embedding: null };
  }

  await context.close().catch(() => {});
  if (ownBrowser) await browser.close().catch(() => {});

  return { ...result, httpStatus, httpStatusText };
}

module.exports = { detectChatbot, ollamaAvailable };
