/* /api/backoffice/expenses
     GET    ?store=&category=&from=&to=
     POST   { store_id?, category, vendor?, amount, expense_date, recurring?, note?, attachment_url? }
     PATCH  { id, ...fields }
     DELETE { id }  (hard delete — nothing else references an expense row) */
import { requirePermission, staffIdentity } from "../_auth.js";
import { boConfigured, boSelect, boInsert, boUpdate, boDelete, enc } from "../_bo-db.js";

const CATEGORIES = new Set(["utilities", "rent", "staff", "equipment", "repairs", "supplier", "other"]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured" });
  if (!requirePermission(req, res, "expenses")) return;
  const identity = staffIdentity(req);

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      const parts = ["select=*", "order=expense_date.desc"];
      if (q.store) parts.push(`store_id=eq.${enc(q.store)}`);
      if (q.category) parts.push(`category=eq.${enc(q.category)}`);
      if (q.from) parts.push(`expense_date=gte.${enc(q.from)}`);
      if (q.to) parts.push(`expense_date=lte.${enc(q.to)}`);
      const rows = await boSelect("bo_expenses", parts.join("&"));
      const total = (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      return res.status(200).json({ rows: rows || [], total });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      const category = String(b.category || "");
      const amount = Number(b.amount);
      if (!CATEGORIES.has(category)) return res.status(400).json({ error: `category must be one of: ${[...CATEGORIES].join(", ")}` });
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be a positive number" });
      if (!b.expense_date) return res.status(400).json({ error: "expense_date required" });
      const row = await boInsert("bo_expenses", {
        store_id: b.store_id || null, category, vendor: b.vendor || null, amount,
        expense_date: b.expense_date, recurring: b.recurring || null, note: b.note || null,
        attachment_url: b.attachment_url || null, created_by: identity.id,
      });
      return res.status(200).json({ ok: true, row: row?.[0] || row });
    }

    if (req.method === "PATCH") {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: "id required" });
      const patch = {};
      for (const f of ["store_id", "category", "vendor", "amount", "expense_date", "recurring", "note", "attachment_url"]) {
        if (b[f] !== undefined) patch[f] = b[f];
      }
      const row = await boUpdate("bo_expenses", `id=eq.${enc(b.id)}`, patch);
      return res.status(200).json({ ok: true, row: row?.[0] || row });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id || req.body?.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const row = await boDelete("bo_expenses", `id=eq.${enc(id)}`);
      return res.status(200).json({ ok: true, row: row?.[0] || row });
    }

    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
