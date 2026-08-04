/* Member ID + the code that goes in the customer's QR.

   The ID number the customer reads off their card is their phone number —
   that is what the shop already knows them by, it is what the POS CRM is
   keyed on, and it is one less thing for anyone to memorise.

   The QR is NOT their phone number, and that distinction is the whole point of
   this file. A membership card gets left on a table, photographed, posted to a
   story. Anything printed in a QR is readable by every stranger with a camera,
   so putting the phone number in there would be publishing the customer's
   number on a card they carry around. What the QR carries instead is a code
   derived from the number with an HMAC: it identifies the member to the shop
   and means nothing at all to anybody else, because reversing it needs the
   deployment's secret.

   That gives both halves of what was asked for. Staff scan and get the
   customer. A stranger scans and gets a meaningless string.

   The secret is one the deployment already has to set — no new environment
   variable to forget, which would otherwise leave every card broken. Set
   MEMBER_QR_SECRET only if you ever want to invalidate every card at once;
   changing it re-issues every code, and the old printed cards stop resolving.  */
import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";
import { normPhone } from "./_phone.js";

const DECADE = 60 * 60 * 24 * 3650;

/* Crockford's alphabet: no I, L, O or U, so a code read down a phone line or
   typed off a card can't turn a 1 into an I or a 0 into an O, and it can't
   accidentally spell anything. */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function memberSecret() {
  return process.env.MEMBER_QR_SECRET || process.env.ADMIN_SECRET || process.env.STAFF_KEY || "";
}
export function memberIdConfigured() {
  return Boolean(memberSecret());
}

/* 12 characters of base32 — 60 bits. Guessing one is not a thing anyone is
   going to do by hand, and the staff lookup is rate-limited and key-gated
   anyway, so this is comfortably more than it needs to be. */
export function memberCode(phone) {
  const p = normPhone(phone);
  if (!p || p.length < 6) return "";
  const sec = memberSecret();
  if (!sec) return "";
  const h = crypto.createHmac("sha256", sec).update("dank-member-v1:" + p).digest();
  let out = "";
  for (let i = 0; i < 12; i++) out += B32[h[i] % 32];
  return out;
}

/* Printed in three groups because a human has to be able to read it back over
   a phone line when a customer's screen is broken. The lookup accepts it with
   or without the dashes, and in either case. */
export function prettyCode(code) {
  const c = String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return c.length === 12 ? c.slice(0, 4) + "-" + c.slice(4, 8) + "-" + c.slice(8) : c;
}
export function cleanCode(code) {
  return String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 12);
}

/* What the QR actually encodes: a link to the staff console with the code in
   the fragment. The fragment is the deliberate part — everything after the #
   stays in the browser and is never sent to the server, so the code does not
   turn up in the platform's access log or in any proxy's, the way a query
   string would. Staff point their ordinary phone camera at the card and the
   console opens on that customer; nothing to install on a shop phone. */
export function cardUrl(host, code) {
  const h = String(host || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return "https://" + h + "/staff.html#m=" + code;
}

/* An HMAC cannot be run backwards, so scanning has to get from the code to the
   member some other way. Two ways, in fact, because either one alone has a
   hole: the stored index is instant but only knows cards that have been opened
   since this shipped, and re-deriving from the member lists covers everyone but
   costs a pass over both lists. Try the index, fall back to the sweep, and
   write the index entry when the sweep finds someone so it is only ever paid
   for once per customer. */
export async function rememberCode(phone) {
  const code = memberCode(phone);
  if (!code) return "";
  try { await setJSON("mcode:" + code, { phone: normPhone(phone), at: Date.now() }, DECADE); } catch (e) {}
  return code;
}

export async function phoneForCode(code) {
  const c = cleanCode(code);
  if (c.length !== 12) return "";
  const hit = await getJSON("mcode:" + c);
  if (hit && hit.phone) return hit.phone;

  const seen = new Set();
  const pools = [
    ((await getJSON("crm:members")) || []).map((m) => m.phone),
    (((await getJSON("pos:customers")) || {}).list || []).map((m) => m.phone || m.d),
  ];
  for (const pool of pools) {
    for (const raw of pool) {
      const p = normPhone(raw);
      if (!p || seen.has(p)) continue;
      seen.add(p);
      if (memberCode(p) === c) {
        try { await setJSON("mcode:" + c, { phone: p, at: Date.now(), via: "sweep" }, DECADE); } catch (e) {}
        return p;
      }
    }
  }
  return "";
}
