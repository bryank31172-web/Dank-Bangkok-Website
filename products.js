/* GET /api/products — the live menu for the storefront.
   Uses the shared near-real-time cache (see _menu.js). Always returns the
   product array (back-compat) and exposes the change-rev + source in headers
   so the storefront can sync without re-downloading when nothing changed. */
import { getMenu } from "./_menu.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    const m = await getMenu();
    res.setHeader("X-Menu-Rev", m.rev);
    res.setHeader("X-Menu-Source", m.source);
    return res.status(200).json(m.data);
  } catch (e) {
    return res.status(500).json({ error: "no menu available" });
  }
}
