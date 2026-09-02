/* /api/customer — everything the shop knows about one customer, for the staff
   console, reached by scanning the QR on their member card.

     GET ?code=XXXXXXXXXXXX   (+ staff key)   → the customer that code belongs to
     GET ?phone=0812345678    (+ staff key)   → the same, typed by hand

   Staff-only, and firmly so. This is the one endpoint in the whole API that
   hands over a named customer's phone number, spending and order history in a
   single reply, which is exactly what makes it useful at the counter and
   exactly what makes it worth guarding: no staff key, no answer, and the key
   is checked before the phone number is even looked at.

   The reply is assembled from what the shop already stores rather than from a
   new customer record, so a member who has never ordered still comes back with
   a sensible profile, and one who ordered before any of this shipped still
   shows their history.                                                       */
import { getJSON, indexList } from "./_store.js";
import { requirePermission } from "./_auth.js";
import { normPhone } from "./_phone.js";
import { getWallet } from "./_wallet.js";
import { memberIdConfigured, memberCode, prettyCode, phoneForCode, cleanCode } from "./_memberid.js";

const ORDER_LIST_MAX = 20;

/* Orders placed before the per-customer index existed are only reachable by
   walking the main index, so a lookup that finds nothing falls back to a
   bounded sweep of recent orders. Bounded because every id is a store read:
   400 is a few weeks of a busy shop, and staff at a counter would rather have
   an answer in a second than a complete one in thirty. */
const SWEEP_MAX = 400;

async function ordersFor(phone) {
  const ids = await indexList("orders:by:" + phone);
  if (ids.length) {
    const out = [];
    for (const id of ids.slice(0, ORDER_LIST_MAX * 3)) {
      const o = await getJSON("order:" + id);
      if (o) out.push(o);
    }
    return { list: out, complete: true };
  }
  const all = await indexList("orders:index");
  const out = [];
  for (const id of all.slice(0, SWEEP_MAX)) {
    const o = await getJSON("order:" + id);
    if (o && normPhone(o.customer?.phone) === phone) out.push(o);
  }
  return { list: out, complete: all.length <= SWEEP_MAX };
}

function money(o) {
  const v = Number(o?.total ?? o?.subtotal ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Staff-Key, Authorization");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  if (!requirePermission(req, res, "owner_tools")) return;

  try {
    const q = req.query || {};
    let phone = "";
    let via = "";

    if (q.code) {
      if (!memberIdConfigured()) {
        return res.status(503).json({ error: "not configured", detail: "ADMIN_SECRET (or MEMBER_QR_SECRET) is not set on this deployment — see .env.example" });
      }
      const c = cleanCode(q.code);
      if (c.length !== 12) return res.status(400).json({ error: "that is not a member code" });
      phone = await phoneForCode(c);
      via = "scan";
      /* A code that resolves to nobody is the interesting failure here: it is
         what staff see when a card was issued on a different deployment, or
         after MEMBER_QR_SECRET was rotated. Say so plainly rather than
         answering "no such customer", which would send them looking for the
         customer instead of at the card. */
      if (!phone) return res.status(200).json({ ok: true, found: false, reason: "unknown-code", code: prettyCode(c) });
    } else if (q.phone) {
      phone = normPhone(q.phone);
      via = "typed";
      if (phone.length < 6) return res.status(400).json({ error: "phone required" });
    } else {
      return res.status(400).json({ error: "code or phone required" });
    }

    /* --- who they are ---------------------------------------------------- */
    const members = (await getJSON("crm:members")) || [];
    const web = members.find((m) => normPhone(m.phone) === phone) || null;
    const crm = (await getJSON("pos:customers")) || null;
    const pc = (crm && crm.list.find((x) => x.d === phone)) || null;

    /* --- what they have -------------------------------------------------- */
    const wallet = await getWallet(phone);
    const { list: orders, complete } = await ordersFor(phone);
    orders.sort((a, b) => (b.at || 0) - (a.at || 0));

    const spent = orders.reduce((s, o) => s + money(o), 0);
    const boxes = orders.reduce((s, o) => s + (Number(o.box?.boxes) || 0), 0);

    /* Their usual — the three things they have bought most often. It is the
       single most useful line on this screen for someone standing at the
       counter, and it costs nothing but a pass over the orders already read. */
    const tally = {};
    orders.forEach((o) => (o.items || []).forEach((i) => {
      const k = String(i.name || "").trim();
      if (k) tally[k] = (tally[k] || 0) + (Number(i.qty) || 1);
    }));
    const usual = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, qty]) => ({ name, qty }));

    const found = Boolean(web || pc || orders.length || wallet.balance);

    /* --- what they are owed ---------------------------------------------- */
    const promos = [
      { id: "member10", label: "10% member price", state: web || pc ? "active" : "not a member yet" },
      { id: "first1g", label: "First order: buy 1G get 1G free", state: orders.length ? "already used" : "still available" },
      { id: "gramladder", label: "Buy 3G→1G free, 5G→2G, 9G→3G, 12G→4G, 15G→5G", state: "every order" },
    ];
    if (boxes) promos.push({ id: "box", label: "Custom box", state: boxes + " ordered" });

    return res.status(200).json({
      ok: true, found, via,
      customer: {
        id: phone,
        name: (web && web.name) || (pc && pc.name) || "",
        phone,
        code: memberCode(phone),
        pretty: prettyCode(memberCode(phone)),
        since: (web && web.at) || null,
        source: web ? web.source || "web" : pc ? "pos" : orders.length ? "order" : "",
        inPos: Boolean(pc),
        inWeb: Boolean(web),
      },
      loyalty: { points: pc ? pc.points || 0 : 0, visits: pc ? pc.visits || 0 : 0, syncedAt: crm ? crm.at : null },
      wallet: { balance: wallet.balance || 0, history: (wallet.history || []).slice(0, 10) },
      orders: {
        count: orders.length,
        complete,
        spent: Math.round(spent),
        last: orders.length ? orders[0].at || null : null,
        usual,
        list: orders.slice(0, ORDER_LIST_MAX).map((o) => ({
          orderId: o.orderId, at: o.at || null, status: o.status || "new",
          total: money(o), payment: o.payment || "", mode: o.mode || o.fulfilment || "",
          items: (o.items || []).map((i) => ({ name: i.name, option: i.option, qty: i.qty, lineTotal: i.lineTotal })),
        })),
      },
      promos,
    });
  } catch (e) {
    console.error("customer lookup error:", e.message);
    return res.status(500).json({ error: "server" });
  }
}
