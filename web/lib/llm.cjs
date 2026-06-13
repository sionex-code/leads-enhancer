// Chat client with two OpenAI-compatible providers:
//
//   groq  https://api.groq.com/openai/v1 — used when GROQ_API_KEY is set.
//         REASONING llama-3.3-70b-versatile, FAST llama-3.1-8b-instant.
//         Groq supports native tool-calls, but the agent keeps its prompt-based
//         JSON tool protocol so both providers behave identically.
//         GROQ_API_KEY may hold MULTIPLE comma-separated keys — on a 429 we
//         rotate to the next key before falling back to the Kiro proxy, so the
//         free-tier 6000 TPM limit on one key doesn't stall a turn.
//   kiro  http://144.91.104.65/v1 (plain HTTP — the HTTPS cert is self-signed).
//         REASONING gemma-4-31b-it, FAST gemma-4-26b-a4b-it.
//         NOTE: the proxy strips the OpenAI `tools` parameter.
//
// The non-primary provider is used as an automatic fallback (e.g. all Groq keys
// 429 → the Kiro proxy). Force a provider with LLM_PROVIDER=groq|kiro.

// One or many keys: "key1,key2" (or GROQ_API_KEYS). Whitespace/commas split.
const GROQ_API_KEYS = (process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || "")
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter(Boolean);

const PROVIDERS = {
  groq: {
    baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
    apiKeys: GROQ_API_KEYS,
    models: {
      reasoning: process.env.GROQ_MODEL_REASONING || "llama-3.3-70b-versatile",
      fast: process.env.GROQ_MODEL_FAST || "llama-3.1-8b-instant",
    },
  },
  kiro: {
    baseUrl: process.env.LLM_BASE_URL || "http://144.91.104.65/v1",
    apiKeys: [process.env.LLM_API_KEY || "local-proxy"],
    models: {
      reasoning: process.env.LLM_MODEL_REASONING || "gemma-4-31b-it",
      fast: process.env.LLM_MODEL_FAST || "gemma-4-26b-a4b-it",
    },
  },
};

const PRIMARY = PROVIDERS[process.env.LLM_PROVIDER] ? process.env.LLM_PROVIDER : (GROQ_API_KEYS.length ? "groq" : "kiro");
const FALLBACK = PRIMARY === "groq" ? "kiro" : (GROQ_API_KEYS.length ? "groq" : null);

async function chatWith(providerName, apiKey, messages, { model, maxTokens, temperature, timeoutMs }) {
  const p = PROVIDERS[providerName];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: p.models[model] || model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`LLM(${providerName}) ${res.status}: ${body.slice(0, 300)}`);
      err.status = res.status;
      // Groq 429 bodies include "Please try again in 7.66s"
      const m = body.match(/try again in ([\d.]+)\s*s/i);
      err.retryAfterMs = m ? Math.ceil(parseFloat(m[1]) * 1000) : Number(res.headers.get("retry-after")) * 1000 || 0;
      throw err;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`LLM(${providerName}) returned no content`);
    return content;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ordered list of (provider, apiKey) attempts: every key of the primary provider
// first, then every key of the fallback. A 429 on one key is retried once (after
// the suggested wait) and then we move to the next key/provider.
function attemptChain() {
  const order = FALLBACK ? [PRIMARY, FALLBACK] : [PRIMARY];
  const chain = [];
  for (const name of order) {
    for (const apiKey of PROVIDERS[name].apiKeys) chain.push({ name, apiKey });
  }
  return chain;
}

async function chat(messages, { model = "fast", maxTokens = 2048, temperature = 0.4, timeoutMs = 180000 } = {}) {
  const opts = { model, maxTokens, temperature, timeoutMs };
  const chain = attemptChain();
  let lastErr;
  for (let i = 0; i < chain.length; i++) {
    const { name, apiKey } = chain[i];
    // Give a rate-limited key one paid retry before rotating to the next one.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await chatWith(name, apiKey, messages, opts);
      } catch (err) {
        lastErr = err;
        if (err.status === 429 && attempt === 0) {
          const waitMs = Math.min(err.retryAfterMs || 8000, 20000);
          console.warn(`[llm] ${name} key#${i + 1} rate-limited, retrying in ${waitMs}ms`);
          await sleep(waitMs);
          continue;
        }
        if (i < chain.length - 1) console.warn(`[llm] ${name} key#${i + 1} failed (${String(err && err.message || err).slice(0, 160)}), trying next`);
        break;
      }
    }
  }
  throw lastErr;
}

module.exports = { chat, MODELS: PROVIDERS[PRIMARY].models, BASE_URL: PROVIDERS[PRIMARY].baseUrl, PRIMARY };
