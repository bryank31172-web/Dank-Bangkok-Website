/* /api/backoffice/kitchen — prep tickets, New → Preparing → Ready → Served.
     GET  ?store=&status=
     POST { store_id, lines:[{menu_item_key,qty,special_instructions?}], order_ref? }
          → new ticket, status 'new'. Does NOT require a payment/checkout —
            order_ref is optional and only links back to an existing online
            order if this ticket came from one.
     PATCH { id, status } → New→Preparing→Ready→Served only, in that order
            (no skipping, no going backwards except to 'cancelled').
   Ingredient consumption: exactly once, on the New→...→Served transition,
   guarded by consumption_recorded so a retried/duplicate PATCH is a no-op.
   A ticket line with no matching recipe is skipped (logged in the response,
   not silently ignored) rather than failing the whole ticket — not every
   menu item needs a recipe to be useful (e.g. a bottled drink with no prep). */
import { requirePermission, staffIdentity } from "../_auth.js";
import { boConfigured, boSelect, boInsert, boUpdate, boLedgerAdjust, enc } from "../_bo-db.js";

const ORDER = ["new", "preparing", "ready", "served"];

export function isValidTransition(from, to) {
  if (to === "cancelled") return from !== "served";
  const fi = ORDER.indexOf(from), ti = ORDER.indexOf(to);
  return fi >= 0 && ti === fi + 1;
}

async function recordConsumption(ticket, lines, staffId) {
  const results = [];
  for (const line of lines) {
    const [recipe] = await boSelect("bo_recipes", `menu_item_key=eq.${enc(line.menu_item_key)}&active=eq.true&select=*,lines:bo_recipe_lines(*)`);
    if (!recipe) { results.push({ menu_item_key: line.menu_item_key, skipped: "no recipe found" }); continue; }
    for (const rl of recipe.lines || []) {
      const qty = Number(rl.qty) * Number(line.qty);
      const row = await boLedgerAdjust({
        itemType: "ingredient", itemKey: rl.ingredient_id, storeId: ticket.store_id,
        qtyDelta: -Math.abs(qty), reason: "kitchen_consumption", refType: "kitchen_ticket", refId: ticket.id,
        staffId, note: `${line.qty}x ${recipe.name}`,
      });
      results.push({ menu_item_key: line.menu_item_key, ingredient_id: rl.ingredient_id, consumed: qty, ledger: row });
    }
  }
  return results;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured" });
  if (!requirePermission(req, res, "kitchen_tickets")) return;
  const identity = staffIdentity(req);

  try {
    if (req.method === "GET") {
      const parts = ["select=*,lines:bo_kitchen_ticket_lines(*)", "order=created_at.desc"];
      if (req.query?.store) parts.push(`store_id=eq.${enc(req.query.store)}`);
      if (req.query?.status) parts.push(`status=eq.${enc(req.query.status)}`);
      else parts.push(`status=neq.cancelled`);
      const rows = await boSelect("bo_kitchen_tickets", parts.join("&"));
      return res.status(200).json({ rows: rows || [] });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!b.store_id) return res.status(400).json({ error: "store_id required" });
      if (!lines.length) return res.status(400).json({ error: "lines required" });
      const [ticket] = await boInsert("bo_kitchen_tickets", {
        store_id: b.store_id, source: b.order_ref ? "order" : "manual", order_ref: b.order_ref || null,
        status: "new", created_by: identity.id,
      });
      await boInsert("bo_kitchen_ticket_lines", lines.map((l) => ({
        ticket_id: ticket.id, menu_item_key: String(l.menu_item_key), qty: Number(l.qty) || 1,
        special_instructions: l.special_instructions || null,
      })));
      const [full] = await boSelect("bo_kitchen_tickets", `id=eq.${enc(ticket.id)}&select=*,lines:bo_kitchen_ticket_lines(*)`);
      return res.status(200).json({ ok: true, row: full || ticket });
    }

    if (req.method === "PATCH") {
      const { id, status } = req.body || {};
      if (!id || !status) return res.status(400).json({ error: "id and status required" });
      const [ticket] = await boSelect("bo_kitchen_tickets", `id=eq.${enc(id)}&select=*,lines:bo_kitchen_ticket_lines(*)`);
      if (!ticket) return res.status(404).json({ error: "ticket not found" });
      if (!isValidTransition(ticket.status, status)) {
        return res.status(409).json({ error: `cannot move from '${ticket.status}' to '${status}'` });
      }

      // Compare-and-swap on the OLD status: two concurrent PATCHes for the same
      // transition race at the database, not in this function, so only one can
      // ever match `status=eq.<ticket.status>` — the loser's WHERE clause finds
      // nothing (the winner already moved it on) and gets back an empty array.
      // This is what actually prevents a double ingredient deduction, not the
      // consumption_recorded flag alone (that's belt-and-braces for a retried
      // request after the first one already won).
      const patch = { status, updated_at: new Date().toISOString() };
      if (status === "served") patch.consumption_recorded = true;
      const [updated] = await boUpdate("bo_kitchen_tickets", `id=eq.${enc(id)}&status=eq.${enc(ticket.status)}`, patch);
      if (!updated) return res.status(409).json({ error: "ticket status changed concurrently — reload and retry" });

      let consumption = null;
      if (status === "served" && !ticket.consumption_recorded) {
        consumption = await recordConsumption(ticket, ticket.lines || [], identity.id);
      }
      return res.status(200).json({ ok: true, row: updated, consumption });
    }

    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
