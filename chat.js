/* POST /api/chat — the open-ended brain for DANK AI, powered by Grok
   (xAI) — the same model family behind Bryan AI in your POS.
   The storefront's built-in engine handles common intents instantly;
   anything it can't answer lands here with the live menu as context.

   Every call spends money on the xAI account, and shoppers use this without
   logging in, so there is no key to ask for. What there is instead: the request
   has to come from a page served by this deployment, one address only gets so
   many calls, and the prompt pieces are length-capped. Before that this was an
   open relay — anybody who found the URL had a free Grok endpoint billed to the
   shop, for as long as they cared to use it.

   Env vars:
     XAI_API_KEY     your xAI API key  (console.x.ai)
     GROK_MODEL      optional, default "grok-4"
     ALLOWED_ORIGIN  optional, comma-separated extra hosts allowed to call this */
import { requireSameOrigin } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";

const MAX_BODY = 20000;    // whole request; a real chat turn is a few hundred bytes
const MAX_MESSAGE = 1000;  // what we forward, and the point past which we stop reading
const MAX_CONTEXT = 4000;  // the menu blob the storefront sends as system context

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;
  if (!(await requireRate(req, res, "chat", 20, 300))) return;
  if (!process.env.XAI_API_KEY) {
    return res.status(200).json({ reply: "" }); // storefront shows its polite fallback
  }

  let size = 0;
  try { size = JSON.stringify(req.body || {}).length; } catch (e) { size = MAX_BODY + 1; }
  if (size > MAX_BODY) return res.status(413).json({ error: "message too large" });

  const { message, context, history } = req.body || {};
  if (!message || typeof message !== "string") return res.status(400).json({ error: "message required" });
  if (message.length > MAX_MESSAGE * 2) return res.status(413).json({ error: "message too long" });

  const system = `${String(context || "You are DANK AI, a friendly budtender for DANK BKK in Bangkok.").slice(0, MAX_CONTEXT)}

Rules:
- Be warm, concise (2-4 sentences), and salesy-but-honest. Goal: help the customer choose and order.
- Answer in the customer's language (Thai or English).
- Only recommend items from the MENU above; quote real prices in ฿.
- Never give medical claims; remind 20+ only if age comes up.
- If the customer seems ready, tell them to tap Add / Checkout in this chat.`;

  const messages = [
    { role: "system", content: system },
    ...(Array.isArray(history) ? history.slice(-8) : []).map((h) => ({
      role: h.role === "user" ? "user" : "assistant",
      content: String(h.text || "").slice(0, 500),
    })),
    { role: "user", content: message.slice(0, MAX_MESSAGE) },
  ];

  try {
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROK_MODEL || "grok-4",
        messages,
        max_tokens: 300,
        temperature: 0.6,
      }),
    });
    if (!r.ok) throw new Error(`xAI ${r.status}`);
    const j = await r.json();
    const reply = j.choices?.[0]?.message?.content?.trim() || "";
    return res.status(200).json({ reply });
  } catch (e) {
    console.error("Grok call failed:", e.message);
    return res.status(200).json({ reply: "" }); // graceful fallback client-side
  }
}
