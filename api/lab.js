/* /api/lab — certificates of analysis for the storefront lab card.

     GET                                    → { reports: { <key>: {...} } }
     POST { key, action:"save", product, report }   → store one certificate
     POST { key, action:"delete", product }         → drop it back to estimated

   The GET is public and unauthenticated, which is the point: the card is
   customer-facing, and a lab result is something a shop publishes rather than
   guards. There is nothing here a walk-in could not read off the printed
   certificate on the counter.

   The POST is staff-only, because it is the difference between the card saying
   "estimated from strain data" and the card saying "we measured this". Only
   somebody holding the certificate should be able to make the site say the
   second thing.

   `product` is a product id from products.json, or the flattened product name
   the rest of the site keys on — index.html looks up both, in that order.    */

import { getReports, saveReport, deleteReport, labKeyOf } from "./_lab.js";
import { requirePermission } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Staff-Key");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      if (!(await requireRate(req, res, "lab", 180, 600))) return;
      const reports = await getReports();
      return res.status(200).json({ reports, count: Object.keys(reports).length });
    }

    if (req.method === "POST") {
      if (!requirePermission(req, res, "owner_tools")) return;
      if (!(await requireRate(req, res, "lab-write", 120, 600))) return;
      const b = req.body || {};
      const action = String(b.action || "save").toLowerCase();
      const product = labKeyOf(b.product || b.id);
      if (!product) return res.status(400).json({ error: "product required" });

      if (action === "save") {
        let saved;
        try {
          saved = await saveReport(product, b.report);
        } catch (e) {
          return res.status(409).json({ error: e.message || "could not save" });
        }
        /* A rejected payload is nearly always the same mistake — the
           cannabinoid boxes were left empty — so say that rather than
           "invalid", which sends somebody hunting through every field. */
        if (!saved) {
          return res.status(400).json({
            error: "a certificate needs at least one cannabinoid percentage",
          });
        }
        return res.status(200).json({ ok: true, ...saved, reports: await getReports() });
      }

      if (action === "delete") {
        const gone = await deleteReport(product);
        return res.status(200).json({ ok: true, deleted: gone, product, reports: await getReports() });
      }

      return res.status(400).json({ error: "unknown action", action });
    }

    return res.status(405).json({ error: "method" });
  } catch (e) {
    console.error("lab:", e?.message || e);
    return res.status(500).json({ error: "server" });
  }
}
