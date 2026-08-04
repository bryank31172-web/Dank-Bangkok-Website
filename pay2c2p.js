/* /api/freegifts — which SKUs are offered as the free 1G (manager-controlled).

   The manager chooses the eligible free-gram SKUs in the staff console; the
   storefront reads them here to build the customer's "choose your free 1G"
   picker. Determination lives in the backend: a stored list (set by the
   manager) takes priority; if unset, it falls back to products flagged
   `freeGift:true` in the menu (StoreHub tag or products.json).

     GET  → { skus: [id,...] }
     POST { key, skus:[...] }  (staff key)  → save the list                */

import { getJSON, setJSON } from "./_store.js";
import { getMenu } from "./_menu.js";
import { requireStaff } from "./_auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      let list = await getJSON("freegifts");
      if (!Array.isArray(list)) {
        const m = await getMenu();
        list = (m.data || []).filter((p) => p.freeGift).map((p) => p.id);
      }
      return res.status(200).json({ skus: list });
    }
    if (req.method === "POST") {
      if (!requireStaff(req, res)) return;
      const b = req.body || {};
      const skus = Array.isArray(b.skus) ? b.skus.slice(0, 100) : [];
      await setJSON("freegifts", skus, 60 * 60 * 24 * 365);
      return res.status(200).json({ ok: true, skus });
    }
    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(500).json({ error: "server" });
  }
}
