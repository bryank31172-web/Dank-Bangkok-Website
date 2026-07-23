/* GET /api/menu-version — tiny change-check for near-real-time sync.
   The storefront polls this every ~30s (and on tab focus / at checkout).
   Returns just the rev + timestamps, so it's cheap; when `rev` differs from
   what the browser holds, the storefront pulls a fresh /api/products.
   Because it goes through the same shared cache, upstream (StoreHub/feed)
   is hit at most once per MENU_TTL_SECONDS no matter how many pollers. */
import { getMenu } from "./_menu.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    const m = await getMenu();
    return res.status(200).json({
      rev: m.rev,
      source: m.source,
      changedAt: m.changedAt,
      at: m.at,
      count: m.data.length,
    });
  } catch (e) {
    return res.status(500).json({ error: "menu unavailable" });
  }
}
