/* GET /api/storehub-raw?key=STAFF_KEY — debug: dumps the raw StoreHub
   /stores, /products and /inventory payloads (+ a normalized preview) so the
   product mapping can be calibrated against your real catalogue after deploy.
   Staff-key protected; never exposed publicly. */
import { shRaw, shConfigured, fetchStoreHubProducts } from "./_storehub.js";

const STAFF_KEY = process.env.STAFF_KEY || "dankstaff";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.query?.key !== STAFF_KEY) return res.status(401).json({ error: "bad key" });
  if (!shConfigured()) return res.status(200).json({ configured: false, note: "Set STOREHUB_STORE + STOREHUB_TOKEN" });
  try {
    const raw = await shRaw();
    let normalized = [];
    try { normalized = (await fetchStoreHubProducts()).slice(0, 10); } catch (e) { normalized = [{ error: e.message }]; }
    return res.status(200).json({
      configured: true,
      storeId: raw.storeId,
      productCount: Array.isArray(raw.products) ? raw.products.length : "n/a",
      sampleRawProduct: Array.isArray(raw.products) ? raw.products[0] : raw.products,
      sampleStore: Array.isArray(raw.stores) ? raw.stores[0] : raw.stores,
      sampleInventory: Array.isArray(raw.inventory) ? raw.inventory.slice(0, 3) : raw.inventory,
      normalizedPreview: normalized,
    });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
