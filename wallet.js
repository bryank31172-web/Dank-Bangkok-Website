/* GET /api/health — "Is the site connected to my backend?" in one call.
   No secrets returned. Reports which data source is live (StoreHub feed /
   MENU_FEED_URL / bundled demo catalog), the product count, and a plain-English
   status so you can confirm the StoreHub link right after deploying.           */
import { getMenu } from "./_menu.js";
import { shConfigured } from "./_storehub.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    const menu = await getMenu(true); // force a fresh upstream read
    const source = menu.source; // "storehub" | "feed" | "bundled" | "empty"
    const count = (menu.data || []).length;
    const shSet = shConfigured();
    const connected = source === "storehub" || source === "feed";

    let status, detail;
    if (source === "storehub") {
      status = "connected";
      detail = `✅ Connected to StoreHub — ${count} live products loading from your POS backend.`;
    } else if (source === "feed") {
      status = "connected";
      detail = `✅ Connected to your custom feed (MENU_FEED_URL) — ${count} products.`;
    } else if (shSet) {
      status = "configured-but-not-loading";
      detail =
        "⚠️ StoreHub credentials ARE set on this deployment, but the live fetch " +
        "returned no products — the site is falling back to the built-in catalog. " +
        "Check the token/store name, or that API access is enabled on the StoreHub account.";
    } else {
      status = "not-connected";
      detail =
        "❌ Not connected to StoreHub yet — the site is showing its built-in demo " +
        "catalog. Add STOREHUB_STORE and STOREHUB_TOKEN in your Vercel project's " +
        "Environment Variables, then redeploy.";
    }

    const sample = (menu.data || []).slice(0, 5).map((p) => ({
      code: p.code || "",
      name: p.name,
      stock: p.stock,
      price: p.price ?? p.priceTiers?.[0]?.price ?? null,
    }));

    return res.status(200).json({
      ok: true,
      connected,
      status,
      detail,
      source,
      products: count,
      storehubConfigured: shSet,
      updated: new Date(menu.at || Date.now()).toISOString(),
      sample,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, connected: false, status: "error", detail: String(e.message || e) });
  }
}
