/* /api/boxgifts — the free gifts that ride along with a DANK Custom Box, and
   how many of each are left.

   Every 28-gram box goes out with a tin of hash, a brownie, a jelly, a pack of
   Backwoods, RAW papers, a tee and a hat. api/order.js consumes them from the
   ledger when an order lands; this endpoint is the two ends of that: the
   storefront reads the list so the box modal and the cart can show what's
   included, and staff set the stock numbers and the StoreHub mapping.

     GET                        → { threshold, gifts:[{id,emoji,label,short}] }
     GET  ?key=<staff>          → the same, plus sku/shId/stock/issued/remaining
     POST { key, action:"save", gifts:[...], threshold }     → replace the list
     POST { key, action:"restock", id, stock }               → set one gift's
                                                               stock and zero
                                                               its issued count

   The public shape deliberately omits the numbers. A customer needs to know
   what comes in the box, not that there are four hats left in the back — that
   is the shop's business, and it is the kind of figure that invites somebody to
   test whether the ledger is real.

   Nothing here ever refuses a sale. `short` is advisory: it tells the
   storefront a gift is oversubscribed so it can soften the wording, and it
   tells staff to substitute. The order still goes through.                  */

import { getGiftConfig, giftStatus, saveGiftConfig, restock, DEFAULT_THRESHOLD } from "./_boxgifts.js";
import { requirePermission, isStaff } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";

/* What a shopper's browser is allowed to see. */
const publicGift = (g) => ({
  id: g.id,
  emoji: g.emoji,
  label: g.label,
  short: Boolean(g.short),
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Staff-Key");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      if (!(await requireRate(req, res, "boxgifts", 120, 600))) return;
      const staff = isStaff(req);

      /* The public read skips the per-gift counter lookups entirely — seven
         extra round trips on every page view, for numbers the page is not
         allowed to print. Staff pay for them because staff are the ones
         looking at them. */
      if (!staff) {
        const cfg = await getGiftConfig();
        const st = await giftStatus().catch(() => null);
        const shortById = Object.fromEntries((st?.gifts || []).map((g) => [g.id, g.short]));
        return res.status(200).json({
          threshold: cfg.threshold,
          gifts: cfg.gifts.map((g) => publicGift({ ...g, short: shortById[g.id] })),
        });
      }

      const st = await giftStatus();
      return res.status(200).json({ ...st, staff: true });
    }

    if (req.method === "POST") {
      if (!requirePermission(req, res, "owner_tools")) return;
      const b = req.body || {};
      const action = String(b.action || (Array.isArray(b.gifts) ? "save" : "")).toLowerCase();

      if (action === "save") {
        if (!Array.isArray(b.gifts)) return res.status(400).json({ error: "gifts must be an array" });
        const cfg = await saveGiftConfig(b.gifts, b.threshold ?? DEFAULT_THRESHOLD);
        return res.status(200).json({ ok: true, ...(await giftStatus()), saved: cfg.gifts.length });
      }

      if (action === "restock") {
        const id = String(b.id || "").trim();
        if (!id) return res.status(400).json({ error: "id required" });
        /* null is meaningful and different from 0: it turns tracking off for
           that gift, so it stops being counted and can never read as short.
           0 means the shop genuinely has none. */
        const stock = b.stock === null || b.stock === "" || b.stock === undefined ? null : Number(b.stock);
        if (stock !== null && !Number.isFinite(stock)) return res.status(400).json({ error: "stock must be a number or null" });
        const g = await restock(id, stock);
        if (!g) return res.status(404).json({ error: "no such gift", id });
        return res.status(200).json({ ok: true, gift: g, ...(await giftStatus()) });
      }

      return res.status(400).json({ error: "unknown action", action });
    }

    return res.status(405).json({ error: "method" });
  } catch (e) {
    console.error("boxgifts:", e?.message || e);
    return res.status(500).json({ error: "server" });
  }
}
