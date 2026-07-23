/* /api/orders — staff-only order list for the console (key = STAFF_KEY).
     GET  ?key=...                       → {orders:[...]} newest first
     POST {orderId, status:"done"|"new", key}  → update order status     */
import { getJSON, setJSON, indexList } from "./_store.js";

const STAFF_KEY = process.env.STAFF_KEY || "dankstaff";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      if (req.query?.key !== STAFF_KEY) return res.status(401).json({ error: "bad key" });
      const ids = await indexList("orders:index");
      const orders = [];
      for (const id of ids.slice(0, 60)) {
        const o = await getJSON("order:" + id);
        if (o) orders.push(o);
      }
      return res.status(200).json({ orders });
    }
    if (req.method === "POST") {
      const b = req.body || {};
      if (b.key !== STAFF_KEY) return res.status(401).json({ error: "bad key" });
      const o = await getJSON("order:" + b.orderId);
      if (!o) return res.status(404).json({ error: "not found" });
      o.status = b.status === "done" ? "done" : "new";
      await setJSON("order:" + b.orderId, o);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "method" });
  } catch (e) {
    console.error("orders error:", e.message);
    return res.status(500).json({ error: "server" });
  }
}
