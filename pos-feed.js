/* /api/member — CRM member sign-ups from the website's 10%-off pop-up.

     POST {name, phone, source?}  → {ok}     (stores the lead; de-dupes by phone)
     GET                          → {ok, count, members}   (owner: see your list)

   Members are stored in the shared store (Upstash Redis when configured).
   Set CRM_WEBHOOK_URL to also forward each new member to your POS/CRM. */
import { getJSON, setJSON } from "./_store.js";

const KEY = "crm:members";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    const list = (await getJSON(KEY)) || [];
    return res.status(200).json({ ok: true, count: list.length, members: list.slice(0, 1000) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const b = req.body || {};
  const name = String(b.name || "").trim();
  const phone = String(b.phone || "").trim();
  if (!name || phone.replace(/\s/g, "").length < 6) return res.status(400).json({ error: "name and phone required" });

  const list = (await getJSON(KEY)) || [];
  if (!list.some((m) => m.phone === phone)) {
    list.unshift({ name, phone, at: b.at || Date.now(), source: String(b.source || "web") });
    try { await setJSON(KEY, list.slice(0, 5000), 60 * 60 * 24 * 3650); } catch (e) {}
  }

  const HOOK = process.env.CRM_WEBHOOK_URL || "";
  if (HOOK) {
    try {
      await fetch(HOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone, at: Date.now(), source: "dankbkk-web" }) });
    } catch (e) {}
  }
  return res.status(200).json({ ok: true });
}
