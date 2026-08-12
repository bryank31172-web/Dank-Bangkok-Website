/* /api/cds — Customer Display System relay.

   The second screen at the counter, the one facing the customer. It shows what
   the budtender is doing right now: the strain being weighed and its live gram
   reading, the order building up line by line, the total, the member discount,
   the payment QR, and a thank-you. Between customers it plays the shop's promo
   posters.

     POST {key, code, state}     → {ok, at}     the POS pushes a new state
     GET  ?code=XXXX             → {ok, at, state}
     GET  ?code=XXXX&since=<ms>  → {ok, at, unchanged:true}   when nothing moved

   Two ways to drive the display, and it listens to both:

     Same machine — the till and the customer screen are two windows of one
     browser. Nothing here is involved: the POS posts the same state object on
     a BroadcastChannel called "dank-cds". Instant, and it keeps working with
     the internet down, which is the case that matters at a counter.

     Separate device — the customer screen is its own tablet. It shows a
     pairing code, the staff type that code into the POS once, and the POS
     pushes here while the tablet polls. Slower (about a second) but it works
     across the room.

   AUTH. Writes need POS_SYNC_KEY, the same shared key the menu push already
   uses. Reads are authorised by the pairing code alone, because the code has
   to live in a URL on a screen that the public can see over the counter — a
   real key would be readable by anyone who picked the tablet up. So the code
   is all a reader gets, and this endpoint makes sure that is worth very
   little: the state is filtered to the fields the screen actually draws, and
   personal data is dropped on the way in. A customer's phone number, address,
   email or member id is never stored here even if the POS sends it, so the
   worst a guessed code can show is somebody's cart and its total.            */
import { getJSON, setJSON } from "./_store.js";
import { safeEq, posSyncKey } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";

const MAX_LINES = 60;
const TTL = 60 * 60; // an idle display's state is not worth keeping for longer

const str = (v, n = 120) => String(v == null ? "" : v).slice(0, n);
const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
const MODES = ["idle", "order", "weigh", "pay", "thanks"];
/* Pictures are drawn into the page, so only shapes a browser will treat as an
   image are kept. A javascript: or data:text/html value must never reach it. */
const img = (v) => (/^(https:\/\/|\/|data:image\/)[^\s"'<>]*$/i.test(String(v || "")) ? str(v, 400) : "");

function clean(s) {
  if (!s || typeof s !== "object") return { mode: "idle" };
  const mode = MODES.includes(s.mode) ? s.mode : "idle";
  const out = {
    mode,
    branch: str(s.branch, 40),
    staff: str(s.staff, 40),
    note: str(s.note, 140),
    currency: str(s.currency, 4) || "THB",
  };
  /* Name and tier only. Whatever else the POS knows about this customer -
     phone, email, address, member id, birthday - stays in the POS. */
  if (s.member && typeof s.member === "object") {
    out.member = {
      name: str(s.member.name, 40),
      tier: str(s.member.tier, 24),
      discountPct: Math.max(0, Math.min(100, num(s.member.discountPct))),
      points: Math.max(0, Math.round(num(s.member.points))),
    };
  }
  if (Array.isArray(s.lines)) {
    out.lines = s.lines.slice(0, MAX_LINES).map((l) => ({
      name: str(l && l.name, 80),
      unit: str(l && l.unit, 24),
      qty: Math.max(0, num(l && l.qty)) || 1,
      price: num(l && l.price),
      free: Boolean(l && l.free),
      img: img(l && l.img),
    })).filter((l) => l.name);
  }
  ["subtotal", "discount", "delivery", "total"].forEach((k) => {
    if (s[k] !== undefined) out[k] = num(s[k]);
  });
  if (s.weigh && typeof s.weigh === "object") {
    out.weigh = {
      name: str(s.weigh.name, 80),
      grams: num(s.weigh.grams),
      target: num(s.weigh.target),
      price: num(s.weigh.price),
      thc: str(s.weigh.thc, 16),
      type: str(s.weigh.type, 16),
      img: img(s.weigh.img),
      stable: Boolean(s.weigh.stable),
    };
  }
  if (s.pay && typeof s.pay === "object") {
    out.pay = {
      method: str(s.pay.method, 24),
      amount: num(s.pay.amount),
      qr: img(s.pay.qr),
      paid: Boolean(s.pay.paid),
      change: num(s.pay.change),
    };
  }
  return out;
}

const okCode = (c) => /^[A-Za-z0-9]{4,12}$/.test(String(c || ""));

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    const code = String(req.query?.code || "");
    if (!okCode(code)) return res.status(400).json({ error: "bad code" });
    if (!(await requireRate(req, res, "cdsget", 240, 60))) return;
    const rec = await getJSON("cds:" + code.toUpperCase());
    if (!rec) return res.status(200).json({ ok: true, paired: false, state: { mode: "idle" } });
    const since = Number(req.query?.since || 0);
    if (since && rec.at && since >= rec.at) {
      return res.status(200).json({ ok: true, paired: true, at: rec.at, unchanged: true });
    }
    return res.status(200).json({ ok: true, paired: true, at: rec.at, state: rec.state });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const secret = posSyncKey();
  if (!secret) return res.status(503).json({ error: "not configured", missing: ["POS_SYNC_KEY"] });
  const b = req.body || {};
  const key = b.key || req.headers["x-api-key"] || "";
  if (!safeEq(key, secret)) return res.status(401).json({ error: "bad key" });
  const code = String(b.code || "");
  if (!okCode(code)) return res.status(400).json({ error: "bad code" });
  /* Weighing streams: a scale settling can push several times a second, and
     that is the point of the screen, so the ceiling is high but not absent. */
  if (!(await requireRate(req, res, "cdspost", 900, 60))) return;

  const at = Date.now();
  await setJSON("cds:" + code.toUpperCase(), { at, state: clean(b.state) }, TTL);
  return res.status(200).json({ ok: true, at });
}
