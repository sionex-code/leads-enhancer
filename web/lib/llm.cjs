// Chat client for the Kiro VPS proxy (OpenAI-compatible). Plain HTTP is used by
// default because the HTTPS endpoint serves a self-signed cert Node would reject.
//
// Models (per the proxy config):
//   REASONING  gemma-4-31b-it      — planning, analysis, report writing
//   FAST       gemma-4-26b-a4b-it  — chat turns, tool-call decisions
//
// NOTE: the proxy strips the OpenAI `tools` parameter (verified: it answers in
// prose instead of emitting tool_calls), so agent tool use is prompt-based JSON.

const BASE_URL = process.env.LLM_BASE_URL || "http://144.91.104.65/v1";
const API_KEY = process.env.LLM_API_KEY || "local-proxy";

const MODELS = {
  reasoning: process.env.LLM_MODEL_REASONING || "gemma-4-31b-it",
  fast: process.env.LLM_MODEL_FAST || "gemma-4-26b-a4b-it",
};

async function chat(messages, { model = "fast", maxTokens = 2048, temperature = 0.4, timeoutMs = 180000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODELS[model] || model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LLM ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("LLM returned no content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chat, MODELS, BASE_URL };
