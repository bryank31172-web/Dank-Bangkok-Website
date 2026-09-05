/* Public, anonymous best-seller ranking for storefront product rails.
   Reads the same orders as /api/sales but returns no customer/payment data. */
import { getJSON, setJSON, indexList } from "./_store.js";

const CACHE_KEY = "public:best-sellers:v1";
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MAX_ORDERS = 600;
const clean = (value) => String(value || "").trim().slice(0, 160);
const keyOf = (item) => clean(item?.shId || item?.productId || item?.id || item?.name).toLowerCase();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const cached = await getJSON(CACHE_KEY);
    if (cached?.at && Date.now() - cached.at < CACHE_TTL_MS && Array.isArray(cached.products)) return res.status(200).json(cached);
    const ids = (await indexList("orders:index", { includeArchive: true })).slice(0, MAX_ORDERS);
    const totals = new Map();
    for (let start = 0; start < ids.length; start += 30) {
      const orders = await Promise.all(ids.slice(start, start + 30).map((id) => getJSON("order:" + id)));
      for (const order of orders) {
        if (!order || order.status === "cancelled" || order.voided) continue;
        for (const item of order.items || []) {
          if (item.free || item.gift || item.bonus1st) continue;
          const key = keyOf(item);
          if (!key) continue;
          const row = totals.get(key) || { key, id: clean(item.shId || item.productId || item.id), name: clean(item.name), quantity: 0 };
          row.quantity += Math.max(1, Number(item.qty) || 1);
          totals.set(key, row);
        }
      }
    }
    const payload = { at: Date.now(), products: [...totals.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10) };
    await setJSON(CACHE_KEY, payload, CACHE_TTL_SECONDS);
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(200).json({ at: Date.now(), products: [] });
  }
}
