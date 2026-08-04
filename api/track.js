/* GET /api/track?id=DK... — customer-facing order status lookup.
   Returns only what the order-holder already knows (status, fulfilment,
   items summary, totals) — no other customers' data, no staff fields.

   The order id is the whole credential here. That is now a defensible position
   because api/order.js gives ids four random characters on top of the clock;
   while they were pure timestamps this endpoint could be walked end to end. The
   rate limit is the other half: it makes sweeping the id space cost real time
   even if a future change makes ids predictable again. A customer refreshing
   their tracking page a few times a minute is nowhere near it.              */
import { getJSON } from "./_store.js";
import { requireRate } from "./_ratelimit.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: "id required" });
  if (!(await requireRate(req, res, "track", 60, 300))) return;
  try {
    const o = await getJSON("order:" + id);
    if (!o) return res.status(200).json({ found: false });
    return res.status(200).json({
      found: true,
      orderId: o.orderId,
      status: o.status || "new",              // new | done
      payStatus: o.payStatus || (["PromptPay","Card"].includes(o.payment) ? "unpaid" : "on_arrival"),
      payment: o.payment,
      fulfilment: o.fulfilment,
      items: (o.items || []).map((i) => ({ name: i.name, option: i.option, qty: i.qty })),
      subtotal: o.subtotal, discount: o.discount || 0, deliveryFee: o.deliveryFee || 0,
      total: o.total ?? o.subtotal,
      zone: o.delivery?.zone || "", branch: o.pickup?.branch || "",
      at: o.at,
    });
  } catch (e) {
    return res.status(500).json({ error: "lookup failed" });
  }
}
