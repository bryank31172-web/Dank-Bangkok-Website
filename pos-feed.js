/* /api/member — CRM member sign-ups + member login for the website.

     POST {name, phone}                    → {ok}          join (de-dupes by phone)
     POST {action:"login", phone}          → {ok, found, points, visits}  returning member
     GET  ?key=STAFF_KEY                   → {ok, count, members}  (owner/staff only)

   Members are stored in the shared store (Upstash Redis when configured).
   Set CRM_WEBHOOK_URL to also forward each new member to your POS/CRM.

   The login lookup deliberately does NOT return the member's name. It takes no
   credential — a phone number is not a secret — so answering with a name turned
   it into a directory anyone could walk: feed it numbers, collect names. It now
   confirms only that the number is known, plus the loyalty figures the
   storefront shows; the storefront already keeps the customer's own name in
   localStorage (dank_reg) from when they joined on that device.            */
import { getJSON, setJSON } from "./_store.js";
import { requireStaff } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";
import { normPhone as digits } from "./_phone.js";

const KEY = "crm:members";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    // member list is staff-only — same key as the staff console
    if (!requireStaff(req, res)) return;
    const list = (await getJSON(KEY)) || [];
    return res.status(200).json({ ok: true, count: list.length, members: list.slice(0, 1000) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  // Both branches below are open to the internet and both take a phone number,
  // so cap how fast one address can try numbers. A real customer logs in or
  // joins once; a script wants thousands of attempts.
  if (!(await requireRate(req, res, "member", 20, 300))) return;

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
      return res.status(200).json({ ok: true, found: true, points: pc ? pc.points : 0, visits: pc ? pc.visits : 0, source: "web" });
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
      return res.status(200).json({ ok: true, found: true, points: pc.points || 0, visits: pc.visits || 0, source: "pos" });
    }
    return res.status(200).json({ ok: true, found: false });
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
