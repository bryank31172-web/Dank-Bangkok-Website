/* /api/member — CRM member sign-ups + member login for the website.

     POST {name, phone}                    → {ok}          join (de-dupes by phone)
     POST {action:"login", phone}          → {ok, found, name}   returning member
     GET  ?key=STAFF_KEY                   → {ok, count, members}  (owner/staff only)

   Members are stored in the shared store (Upstash Redis when configured).
   Set CRM_WEBHOOK_URL to also forward each new member to your POS/CRM.     */
import { getJSON, setJSON } from "./_store.js";

const KEY = "crm:members";
const STAFF_KEY = process.env.STAFF_KEY || "dankstaff";
const digits = (s) => String(s || "").replace(/[^0-9]/g, "").replace(/^66/, "0");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    // member list is staff-only — same key as the staff console
    if (req.query?.key !== STAFF_KEY) return res.status(401).json({ error: "bad key" });
    const list = (await getJSON(KEY)) || [];
    return res.status(200).json({ ok: true, count: list.length, members: list.slice(0, 1000) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const b = req.body || {};

  if (b.action === "login") {
    const ph = digits(b.phone);
    if (ph.length < 6) return res.status(400).json({ error: "phone required" });
    // 1) members who joined on the website
    const list = (await getJSON(KEY)) || [];
    const m = list.find((x) => digits(x.phone) === ph);
    if (m) {
      // enrich with POS CRM points if the same person exists there
      const crm = (await getJSON("pos:customers")) || null;
      const pc = crm && crm.list.find((x) => x.d === ph);
      return res.status(200).json({ ok: true, found: true, name: m.name, points: pc ? pc.points : 0, visits: pc ? pc.visits : 0, source: "web" });
    }
    // 2) customers from the BRYAN POS CRM (joined in the shop)
    const crm = (await getJSON("pos:customers")) || null;
    const pc = crm && crm.list.find((x) => x.d === ph);
    if (pc) {
      // remember them in the website member list too (unified CRM)
      if (!list.some((x) => digits(x.phone) === ph)) {
        list.unshift({ name: pc.name || "Member", phone: b.phone, at: Date.now(), source: "pos-login" });
        try { await setJSON(KEY, list.slice(0, 5000), 60 * 60 * 24 * 3650); } catch (e) {}
      }
      return res.status(200).json({ ok: true, found: true, name: pc.name || "", points: pc.points || 0, visits: pc.visits || 0, source: "pos" });
    }
    return res.status(200).json({ ok: true, found: false, name: "" });
  }

  const name = String(b.name || "").trim();
  const phone = String(b.phone || "").trim();
  if (!name || phone.replace(/\s/g, "").length < 6) return res.status(400).json({ error: "name and phone required" });

  const list = (await getJSON(KEY)) || [];
  if (!list.some((m) => digits(m.phone) === digits(phone))) {
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
