// Chat client with two OpenAI-compatible providers:
//
//   groq  https://api.groq.com/openai/v1 — used when GROQ_API_KEY is set.
//         REASONING llama-3.3-70b-versatile, FAST llama-3.1-8b-instant.
//         Groq supports native tool-calls, but the agent keeps its prompt-based
//         JSON tool protocol so both providers behave identically.
//   kiro  http://144.91.104.65/v1 (plain HTTP — the HTTPS cert is self-signed).
//         REASONING gemma-4-31b-it, FAST gemma-4-26b-a4b-it.
//         NOTE: the proxy strips the OpenAI `tools` parameter.
//
// The non-primary provider is used as an automatic fallback (e.g. Groq free-tier
// 429s fall back to the Kiro proxy). Force a provider with LLM_PROVIDER=groq|kiro.

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

const PROVIDERS = {
  groq: {
    baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
    apiKey: GROQ_API_KEY,
    models: {
      reasoning: process.env.GROQ_MODEL_REASONING || "llama-3.3-70b-versatile",
      fast: process.env.GROQ_MODEL_FAST || "llama-3.1-8b-instant",
    },
  },
  kiro: {
    baseUrl: process.env.LLM_BASE_URL || "http://144.91.104.65/v1",
    apiKey: process.env.LLM_API_KEY || "local-proxy",
    models: {
      reasoning: process.env.LLM_MODEL_REASONING || "gemma-4-31b-it",
      fast: process.env.LLM_MODEL_FAST || "gemma-4-26b-a4b-it",
    },
  },
};

const PRIMARY = PROVIDERS[process.env.LLM_PROVIDER] ? process.env.LLM_PROVIDER : (GROQ_API_KEY ? "groq" : "kiro");
const FALLBACK = PRIMARY === "groq" ? "kiro" : (GROQ_API_KEY ? "groq" : null);

async function chatWith(providerName, messages, { model, maxTokens, temperature, timeoutMs }) {
  const p = PROVIDERS[providerName];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.apiKey}`,
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

async function chat(messages, { model = "fast", maxTokens = 2048, temperature = 0.4, timeoutMs = 180000 } = {}) {
  const opts = { model, maxTokens, temperature, timeoutMs };
  let lastErr;
  // Rate limits (Groq free tier is 6000 TPM) are transient: wait the suggested
  // time and retry the primary before giving the turn to the fallback provider.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chatWith(PRIMARY, messages, opts);
    } catch (err) {
      lastErr = err;
      if (err.status !== 429 || attempt === 2) break;
      const waitMs = Math.min(err.retryAfterMs || 10000, 30000);
      console.warn(`[llm] ${PRIMARY} rate-limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/3)`);
      await sleep(waitMs);
    }
  }
  if (!FALLBACK) throw lastErr;
  console.warn(`[llm] ${PRIMARY} failed (${String(lastErr && lastErr.message || lastErr).slice(0, 200)}), falling back to ${FALLBACK}`);
  return await chatWith(FALLBACK, messages, opts);
}

module.exports = { chat, MODELS: PROVIDERS[PRIMARY].models, BASE_URL: PROVIDERS[PRIMARY].baseUrl, PRIMARY };
