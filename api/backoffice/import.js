/* /api/backoffice/import — CSV import validation, duplicate detection, and
   reconciliation (Module G: "Implement import validation, duplicate
   detection, and reconciliation").

   This is deliberately NOT a way to create new confirmed expenses or sales
   from an uploaded file — the brief is explicit: "Never fabricate financial
   information or treat unverified sales as confirmed revenue." An import
   batch is a snapshot of what an external file said (a bank statement, a
   delivery platform settlement, an accounting export), checked AGAINST what
   BackOffice/the shop already has recorded. The output is a reconciliation:
   which rows matched an existing record (reassuring — the books agree),
   which didn't (needs a human to look: either a missed entry or a real
   discrepancy), which were invalid, and which were duplicates within the
   file itself. Nothing here writes to bo_expenses or creates an order.

     POST { import_type:'expenses'|'sales', source_label, rows:[{date,amount,description?}] }
          → validates + matches, stores the batch + per-row results, returns the summary
     GET  ?batch_id=<id>   → one batch with all its rows
     GET  (no params)      → recent batches, newest first */
import { requirePermission, staffIdentity } from "../_auth.js";
import { boConfigured, boSelect, boInsert, enc } from "../_bo-db.js";
import { getJSON, indexList } from "../_store.js";

function parseDate(raw) {
  const s = String(raw || "").trim();
  // Accepts YYYY-MM-DD, DD/MM/YYYY, D/M/YYYY — the shapes a bank/accounting
  // CSV export or a spreadsheet's "save as CSV" commonly produces.
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const [, d, mo, y] = m;
    const dd = String(d).padStart(2, "0"), mm = String(mo).padStart(2, "0");
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) return `${y}-${mm}-${dd}`;
  }
  return null;
}

function parseAmount(raw) {
  const n = Number(String(raw || "").replace(/[,\s฿]/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function existingExpenses(fromDate, toDate) {
  const parts = ["select=id,expense_date,amount,vendor,category", `expense_date=gte.${enc(fromDate)}`, `expense_date=lte.${enc(toDate)}`];
  return boSelect("bo_expenses", parts.join("&"));
}

async function existingOrdersNear(fromMs, toMs) {
  const ids = await indexList("orders:index");
  const out = [];
  for (const id of ids.slice(0, 1000)) {
    const o = await getJSON("order:" + id);
    if (!o || !o.at || o.status === "cancelled") continue;
    if (o.at < fromMs || o.at > toMs) continue;
    out.push({ id: o.orderId, at: o.at, total: Math.round(Number(o.total) || 0) });
  }
  return out;
}

const DAY = 86400000;
const AMOUNT_TOLERANCE = 0.5; // baht — covers rounding differences between a bank feed and recorded figures

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured" });
  if (!requirePermission(req, res, "expenses")) return; // reconciliation is a financial-review action
  const identity = staffIdentity(req);

  try {
    if (req.method === "GET") {
      if (req.query?.batch_id) {
        const [batch] = await boSelect("bo_import_batches", `id=eq.${enc(req.query.batch_id)}&select=*`);
        if (!batch) return res.status(404).json({ error: "batch not found" });
        const rows = await boSelect("bo_import_rows", `batch_id=eq.${enc(req.query.batch_id)}&select=*&order=row_number.asc`);
        return res.status(200).json({ batch, rows: rows || [] });
      }
      const rows = await boSelect("bo_import_batches", "select=*&order=created_at.desc&limit=50");
      return res.status(200).json({ rows: rows || [] });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    const b = req.body || {};
    const importType = b.import_type;
    const sourceLabel = String(b.source_label || "").trim();
    const rawRows = Array.isArray(b.rows) ? b.rows : [];
    if (!["expenses", "sales"].includes(importType)) return res.status(400).json({ error: "import_type must be 'expenses' or 'sales'" });
    if (!sourceLabel) return res.status(400).json({ error: "source_label required (e.g. a filename or statement name)" });
    if (!rawRows.length) return res.status(400).json({ error: "rows required" });
    if (rawRows.length > 2000) return res.status(400).json({ error: "max 2000 rows per import" });

    // ---- parse + validate ----
    const parsed = rawRows.map((r, i) => ({
      rowNumber: i + 1,
      rawDate: r.date, rawAmount: r.amount, rawDescription: r.description || "",
      date: parseDate(r.date), amount: parseAmount(r.amount),
    }));
    const invalid = parsed.filter((r) => !r.date || r.amount === null || r.amount <= 0);
    const valid = parsed.filter((r) => r.date && r.amount !== null && r.amount > 0);

    // ---- duplicate detection: same date+amount+description appearing more than once IN THIS FILE ----
    const seen = new Map();
    const duplicates = [];
    const unique = [];
    for (const r of valid) {
      const key = `${r.date}|${r.amount.toFixed(2)}|${r.rawDescription.trim().toLowerCase()}`;
      if (seen.has(key)) duplicates.push(r);
      else { seen.set(key, true); unique.push(r); }
    }

    // ---- reconciliation: match each unique valid row against what's already recorded ----
    const dates = unique.map((r) => r.date).sort();
    const matched = [];
    const unmatched = [];
    let matchedAmount = 0, unmatchedAmount = 0;

    if (unique.length) {
      if (importType === "expenses") {
        const existing = await existingExpenses(dates[0], dates[dates.length - 1]);
        const pool = (existing || []).map((e) => ({ ...e, used: false }));
        for (const r of unique) {
          const hit = pool.find((e) => !e.used && e.expense_date === r.date && Math.abs(Number(e.amount) - r.amount) <= AMOUNT_TOLERANCE);
          if (hit) { hit.used = true; matched.push({ ...r, matchedId: hit.id }); matchedAmount += r.amount; }
          else { unmatched.push(r); unmatchedAmount += r.amount; }
        }
      } else {
        const fromMs = Date.parse(dates[0] + "T00:00:00Z") - DAY;
        const toMs = Date.parse(dates[dates.length - 1] + "T23:59:59Z") + DAY;
        const existing = await existingOrdersNear(fromMs, toMs);
        const pool = existing.map((o) => ({ ...o, used: false }));
        for (const r of unique) {
          const rowMs = Date.parse(r.date + "T12:00:00Z"); // noon, so same-day orders are within range regardless of time zone offset
          const hit = pool.find((o) => !o.used && Math.abs(o.at - rowMs) <= DAY && Math.abs(o.total - r.amount) <= AMOUNT_TOLERANCE);
          if (hit) { hit.used = true; matched.push({ ...r, matchedId: hit.id }); matchedAmount += r.amount; }
          else { unmatched.push(r); unmatchedAmount += r.amount; }
        }
      }
    }

    // ---- persist the batch + rows as evidence, never as new expenses/orders ----
    const [batch] = await boInsert("bo_import_batches", {
      import_type: importType, source_label: sourceLabel, imported_by: identity.id,
      row_count: rawRows.length, valid_count: unique.length, duplicate_count: duplicates.length, invalid_count: invalid.length,
      matched_amount: Math.round(matchedAmount * 100) / 100, unmatched_amount: Math.round(unmatchedAmount * 100) / 100,
    });

    const rowsToInsert = [
      ...invalid.map((r) => ({
        batch_id: batch.id, row_number: r.rowNumber, raw_date: String(r.rawDate ?? ""), raw_amount: String(r.rawAmount ?? ""),
        raw_description: r.rawDescription, parsed_date: null, parsed_amount: null, status: "invalid",
        reason: !r.date ? "unparseable date" : "amount missing or not positive",
      })),
      ...duplicates.map((r) => ({
        batch_id: batch.id, row_number: r.rowNumber, raw_date: r.rawDate, raw_amount: String(r.rawAmount), raw_description: r.rawDescription,
        parsed_date: r.date, parsed_amount: r.amount, status: "duplicate", reason: "same date/amount/description already appeared earlier in this file",
      })),
      ...matched.map((r) => ({
        batch_id: batch.id, row_number: r.rowNumber, raw_date: r.rawDate, raw_amount: String(r.rawAmount), raw_description: r.rawDescription,
        parsed_date: r.date, parsed_amount: r.amount, status: "matched",
        matched_entity_type: importType === "expenses" ? "expense" : "order", matched_entity_id: String(r.matchedId),
      })),
      ...unmatched.map((r) => ({
        batch_id: batch.id, row_number: r.rowNumber, raw_date: r.rawDate, raw_amount: String(r.rawAmount), raw_description: r.rawDescription,
        parsed_date: r.date, parsed_amount: r.amount, status: "unmatched", reason: "no recorded " + (importType === "expenses" ? "expense" : "order") + " found within tolerance",
      })),
    ];
    if (rowsToInsert.length) await boInsert("bo_import_rows", rowsToInsert);

    return res.status(200).json({
      ok: true,
      batch,
      summary: {
        total: rawRows.length, valid: unique.length, duplicates: duplicates.length, invalid: invalid.length,
        matched: matched.length, unmatched: unmatched.length,
        matchedAmount: batch.matched_amount, unmatchedAmount: batch.unmatched_amount,
      },
    });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
