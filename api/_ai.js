/* api/_ai.js — the one place that decides which AI service answers.

   Every service below speaks the same OpenAI-shaped /chat/completions
   request, so changing brains is a matter of which key is set in Vercel.
   No code change, no redeploy of anything but the env var.

   The list is ordered cheapest-first: whichever key is present wins, and
   a free tier is preferred over a paid one. Set AI_PROVIDER to force a
   particular name if more than one key is configured.

   Env vars:
     GEMINI_API_KEY      Google AI Studio — has a real free tier
     GROQ_API_KEY        Groq — free tier, very fast
     OPENROUTER_API_KEY  OpenRouter — ":free" models cost nothing
     DEEPSEEK_API_KEY    DeepSeek — paid but very cheap
     OPENAI_API_KEY      OpenAI
     XAI_API_KEY         xAI / Grok (what this site used before)
     AI_PROVIDER         optional, forces one of the names above
     AI_MODEL            optional, overrides the default model
     GROK_MODEL          legacy, still honoured when the provider is xai */

const PROVIDERS = [
  {
    name: "gemini",
    env: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
  },
  {
    name: "groq",
    env: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
  },
  {
    name: "openrouter",
    env: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "meta-llama/llama-3.3-70b-instruct:free",
  },
  {
    name: "deepseek",
    env: "DEEPSEEK_API_KEY",
    url: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
  },
  {
    name: "openai",
    env: "OPENAI_API_KEY",
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  },
  {
    name: "xai",
    env: "XAI_API_KEY",
    url: "https://api.x.ai/v1/chat/completions",
    model: "grok-4",
  },
];

/** Which service is actually configured, or null when none is.
    Returns {name, url, key, model} — the key is for the fetch below only,
    never for anything that answers a browser. */
export function aiProvider() {
  const forced = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  const list = forced ? PROVIDERS.filter((p) => p.name === forced) : PROVIDERS;
  for (const p of list) {
    const key = String(process.env[p.env] || "").trim();
    if (!key) continue;
    const legacy = p.name === "xai" ? process.env.GROK_MODEL : "";
    return {
      name: p.name,
      url: p.url,
      key,
      model: String(process.env.AI_MODEL || legacy || p.model).trim(),
    };
  }
  return null;
}

/** True when some brain is wired. Callers use this to fall back gracefully
    rather than showing an error — a missing key must never look broken. */
export function aiOn() {
  return Boolean(aiProvider());
}

/** Send an OpenAI-shaped message list and get the reply text back.
    Throws on a missing key or a bad response; every caller already has a
    catch that degrades to its own offline answer. */
export async function aiChat(messages, { maxTokens = 300, temperature = 0.6 } = {}) {
  const p = aiProvider();
  if (!p) throw new Error("no AI provider configured");

  const headers = {
    Authorization: `Bearer ${p.key}`,
    "Content-Type": "application/json",
  };
  // OpenRouter asks callers to identify themselves; it is not a secret.
  if (p.name === "openrouter") {
    headers["HTTP-Referer"] = "https://dankbangkok.com";
    headers["X-Title"] = "DANK BKK";
  }

  const r = await fetch(p.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: p.model, messages, max_tokens: maxTokens, temperature }),
  });
  if (!r.ok) throw new Error(`${p.name} ${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content?.trim() || "";
}
