/* /api/member — CRM member sign-ups + member login for the website.

     POST {name, phone}                    → {ok}          join (de-dupes by phone)
     POST {action:"login", phone}          → {ok, found, points, visits}  returning member
     POST {action:"card", phone}           → {ok, found, id, code, url}   their member card
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
import { memberIdConfigured, memberCode, prettyCode, cardUrl, rememberCode } from "./_memberid.js";

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

  /* The customer's own card: the ID number they read off it, the scan code
     that goes in the QR, and the link that code encodes.

     No credential is asked for, and none can be — the storefront calls this
     from the customer's own browser, and there is no login to check against.
     That is only acceptable because the answer tells a caller nothing they did
     not already have to know: the ID number IS the phone number they typed in,
     and the code is useless without the staff key, which the staff lookup
     demands separately. Someone who feeds it other people's numbers learns
     whether that number is a member — the same thing action:"login" already
     tells them, behind the same rate limit. */
  if (b.action === "card") {
    if (!memberIdConfigured()) {
      return res.status(503).json({ error: "not configured", detail: "ADMIN_SECRET (or MEMBER_QR_SECRET) is not set on this deployment — see .env.example" });
    }
    const ph = digits(b.phone);
    if (ph.length < 6) return res.status(400).json({ error: "phone required" });

    const list = (await getJSON(KEY)) || [];
    const web = list.find((x) => digits(x.phone) === ph) || null;
    const crm = (await getJSON("pos:customers")) || null;
    const pc = (crm && crm.list.find((x) => x.d === ph)) || null;
    const found = Boolean(web || pc);

    /* Written to the reverse index only for someone the shop actually knows,
       so a stranger poking at this can't fill the store with junk keys. An
       unknown number still gets its code back — it is a pure function of the
       number, and the staff screen handles "not in the CRM yet" — it simply
       does not get indexed until they are really a member. */
    const code = found ? await rememberCode(ph) : memberCode(ph);
    const host = req.headers["x-forwarded-host"] || req.headers.host || "";

    return res.status(200).json({
      ok: true, found,
      id: ph,                       // the number on the card, normalised
      code, pretty: prettyCode(code),
      url: cardUrl(host, code),
      points: pc ? pc.points || 0 : 0,
      visits: pc ? pc.visits || 0 : 0,
      since: web && web.at ? web.at : null,
    });
  }

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
