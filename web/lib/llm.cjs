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
      throw new Error(`LLM(${providerName}) ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error(`LLM(${providerName}) returned no content`);
    return content;
  } finally {
    clearTimeout(timer);
  }
}

async function chat(messages, { model = "fast", maxTokens = 2048, temperature = 0.4, timeoutMs = 180000 } = {}) {
  const opts = { model, maxTokens, temperature, timeoutMs };
  try {
    return await chatWith(PRIMARY, messages, opts);
  } catch (err) {
    if (!FALLBACK) throw err;
    console.warn(`[llm] ${PRIMARY} failed (${String(err && err.message || err).slice(0, 200)}), falling back to ${FALLBACK}`);
    return await chatWith(FALLBACK, messages, opts);
  }
}

module.exports = { chat, MODELS: PROVIDERS[PRIMARY].models, BASE_URL: PROVIDERS[PRIMARY].baseUrl, PRIMARY };
