/* /api/backoffice/product-settings — BackOffice-only fields layered onto BRYAN
   POS products, keyed by the product_key (id/SKU) api/_menu.js already assigns.
   Never writes name/price/category — that stays owned by BRYAN POS.
     GET   ?product_key=                                        → settings + per-store thresholds
     POST  { product_key, supplier_id?, cost_price?, track_stock? }   → upsert product-level fields
     POST  { product_key, store_id, low_stock_threshold?, ideal_stock? } → upsert per-store par levels
   Which POST shape runs is decided by presence of store_id. */
import { requirePermission } from "../_auth.js";
import { boConfigured, boSelect, boUpsert, enc } from "../_bo-db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured" });

  try {
    if (req.method === "GET") {
      if (!requirePermission(req, res, "inventory_view")) return;
      if (req.query?.catalog === "1") {
        const rows = [];
        const pageSize = 500;
        for (let offset = 0; ; offset += pageSize) {
          const page = await boSelect("bo_product_settings", `select=product_key,cost_price&order=product_key.asc&limit=${pageSize}&offset=${offset}`);
          rows.push(...page);
          if (page.length < pageSize) break;
        }
        return res.status(200).json({ rows });
      }
      const key = req.query?.product_key;
      if (!key) return res.status(400).json({ error: "product_key required" });
      const [settings] = await boSelect("bo_product_settings", `product_key=eq.${enc(key)}&select=*`);
      const storeSettings = await boSelect("bo_product_stock_settings", `product_key=eq.${enc(key)}&select=*`);
      return res.status(200).json({ settings: settings || null, storeSettings: storeSettings || [] });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    if (!requirePermission(req, res, "inventory_adjust")) return;
    const b = req.body || {};
    if (!b.product_key) return res.status(400).json({ error: "product_key required" });

    if (b.store_id) {
      const row = await boUpsert("bo_product_stock_settings", {
        product_key: b.product_key, store_id: b.store_id,
        low_stock_threshold: b.low_stock_threshold ?? null, ideal_stock: b.ideal_stock ?? null,
      }, "product_key,store_id");
      return res.status(200).json({ ok: true, row: row?.[0] || row });
    }

    const row = await boUpsert("bo_product_settings", {
      product_key: b.product_key, supplier_id: b.supplier_id ?? null,
      cost_price: b.cost_price ?? null, track_stock: b.track_stock ?? true,
      updated_at: new Date().toISOString(),
    }, "product_key");
    return res.status(200).json({ ok: true, row: row?.[0] || row });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
