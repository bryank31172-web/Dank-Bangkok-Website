/* /api/backoffice/expenses
     GET    ?store=&category=&from=&to=          → rows + total
     GET    ?monthly=1 (+ same filters)           → rows grouped by YYYY-MM × category,
            for the brief's "monthly cost analysis" ask — computed here, not
            client-side, so it stays correct as the expense list grows past
            what's reasonable to ship to the browser in one response.
     POST   { store_id?, category, vendor?, amount, expense_date, recurring?,
              note?, attachment?: dataURL, attachment_url?: plain link }
     PATCH  { id, ...fields }
     DELETE { id }  (hard delete — nothing else references an expense row)

   `attachment` (a data: URL, same convention api/count.js already uses for
   shift-count proof photos) and `attachment_url` (a plain link, e.g. to an
   externally-hosted receipt) are both accepted into the same column — a
   receipt is one or the other, never both, so there's no need for a second
   column just to tell them apart.

   RECURRING EXPENSES: every GET first calls generateDueRecurring(), which
   finds expenses with `recurring` set whose next occurrence date has
   arrived and are not yet marked `next_generated`, inserts the successor
   row (same category/vendor/amount/store, new expense_date, `recurring`
   carried forward so the chain continues, `generated_from` pointing back),
   and flips `next_generated` on the original — guarded by a WHERE clause on
   `next_generated=false` so two near-simultaneous requests can't both spawn
   a successor (same compare-and-swap shape as the kitchen ticket guard in
   api/backoffice/kitchen.js). Generation happens on read rather than on a
   cron: this repo has no scheduled task runner, and "the next occurrence
   appears whenever anyone next looks" is simpler and can't silently stop
   firing the way an unmonitored cron job can. */
import { requirePermission, staffIdentity } from "../_auth.js";
import { boConfigured, boSelect, boInsert, boUpdate, boDelete, boAudit, enc } from "../_bo-db.js";

function addInterval(dateStr, recurring) {
  const d = new Date(dateStr + "T00:00:00Z");
  if (recurring === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (recurring === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (recurring === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else return null;
  return d.toISOString().slice(0, 10);
}

async function generateDueRecurring(actorId) {
  const candidates = await boSelect("bo_expenses", "recurring=not.is.null&next_generated=eq.false&select=*");
  const today = new Date().toISOString().slice(0, 10);
  const generated = [];
  for (const row of candidates || []) {
    const nextDate = addInterval(row.expense_date, row.recurring);
    if (!nextDate || nextDate > today) continue;
    // Claim the right to generate this row's successor — if another
    // concurrent request already flipped next_generated, this WHERE matches
    // nothing and we skip rather than double-spawn.
    const claimed = await boUpdate("bo_expenses", `id=eq.${enc(row.id)}&next_generated=eq.false`, { next_generated: true });
    if (!claimed?.length) continue;
    const [next] = await boInsert("bo_expenses", {
      store_id: row.store_id, category: row.category, vendor: row.vendor, amount: row.amount,
      expense_date: nextDate, recurring: row.recurring, note: row.note,
      created_by: "system:recurring", generated_from: row.id,
    });
    await boAudit({
      actorId: actorId || "system:recurring", action: "create", entityType: "expense", entityId: next.id,
      after: next, note: `auto-generated ${row.recurring} successor of expense ${row.id}`,
    });
    generated.push(next);
  }
  return generated;
}

const CATEGORIES = new Set(["utilities", "rent", "staff", "equipment", "repairs", "supplier", "other"]);
const MAX_ATTACHMENT_BYTES = 700000; // matches api/count.js's photo cap

function resolveAttachment(b) {
  if (b.attachment) {
    if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(b.attachment)) {
      throw Object.assign(new Error("attachment must be a PNG/JPEG/WebP/GIF data URL"), { status: 400 });
    }
    if (b.attachment.length > MAX_ATTACHMENT_BYTES) {
      throw Object.assign(new Error("attachment is too large (max ~700KB)"), { status: 413 });
    }
    return b.attachment;
  }
  if (b.attachment_url) {
    if (!/^https?:\/\//i.test(b.attachment_url)) throw Object.assign(new Error("attachment_url must be an http(s) link"), { status: 400 });
    return b.attachment_url;
  }
  return undefined; // caller decides whether "no change" or "no value" applies
}

function monthlyBreakdown(rows) {
  const byMonth = new Map();
  for (const r of rows) {
    const month = String(r.expense_date || "").slice(0, 7); // YYYY-MM
    if (!month) continue;
    const rec = byMonth.get(month) || { month, total: 0, byCategory: {} };
    rec.total += Number(r.amount) || 0;
    rec.byCategory[r.category] = (rec.byCategory[r.category] || 0) + (Number(r.amount) || 0);
    byMonth.set(month, rec);
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured" });
  if (!requirePermission(req, res, "expenses")) return;
  const identity = staffIdentity(req);

  try {
    if (req.method === "GET") {
      await generateDueRecurring(identity?.id);
      const q = req.query || {};
      const parts = ["select=*", "order=expense_date.desc"];
      if (q.store) parts.push(`store_id=eq.${enc(q.store)}`);
      if (q.category) parts.push(`category=eq.${enc(q.category)}`);
      if (q.from) parts.push(`expense_date=gte.${enc(q.from)}`);
      if (q.to) parts.push(`expense_date=lte.${enc(q.to)}`);
      const rows = await boSelect("bo_expenses", parts.join("&"));
      const total = (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      if (q.monthly) return res.status(200).json({ rows: rows || [], total, monthly: monthlyBreakdown(rows || []) });
      return res.status(200).json({ rows: rows || [], total });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      const category = String(b.category || "");
      const amount = Number(b.amount);
      if (!CATEGORIES.has(category)) return res.status(400).json({ error: `category must be one of: ${[...CATEGORIES].join(", ")}` });
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be a positive number" });
      if (!b.expense_date) return res.status(400).json({ error: "expense_date required" });
      let attachment_url;
      try { attachment_url = resolveAttachment(b) ?? null; } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
      const row = await boInsert("bo_expenses", {
        store_id: b.store_id || null, category, vendor: b.vendor || null, amount,
        expense_date: b.expense_date, recurring: b.recurring || null, note: b.note || null,
        attachment_url, created_by: identity.id,
      });
      const created = row?.[0] || row;
      await boAudit({ actorId: identity.id, action: "create", entityType: "expense", entityId: created.id, after: created });
      return res.status(200).json({ ok: true, row: created });
    }

    if (req.method === "PATCH") {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: "id required" });
      const patch = {};
      for (const f of ["store_id", "category", "vendor", "amount", "expense_date", "recurring", "note"]) {
        if (b[f] !== undefined) patch[f] = b[f];
      }
      if (b.attachment !== undefined || b.attachment_url !== undefined) {
        try { patch.attachment_url = resolveAttachment(b) ?? null; } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
      }
      const [before] = await boSelect("bo_expenses", `id=eq.${enc(b.id)}&select=*`);
      const row = await boUpdate("bo_expenses", `id=eq.${enc(b.id)}`, patch);
      const updated = row?.[0] || row;
      await boAudit({ actorId: identity.id, action: "update", entityType: "expense", entityId: b.id, before, after: updated });
      return res.status(200).json({ ok: true, row: updated });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id || req.body?.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const [before] = await boSelect("bo_expenses", `id=eq.${enc(id)}&select=*`);
      const row = await boDelete("bo_expenses", `id=eq.${enc(id)}`);
      const deleted = row?.[0] || row;
      await boAudit({ actorId: identity.id, action: "delete", entityType: "expense", entityId: id, before, note: "hard delete" });
      return res.status(200).json({ ok: true, row: deleted });
    }

    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
