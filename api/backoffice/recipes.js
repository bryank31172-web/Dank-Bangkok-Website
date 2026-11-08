/* /api/backoffice/recipes — menu item → ingredient-quantity mapping + costing.
     GET  ?menu_item_key=  → recipes (with lines + computed cost) for one menu item, or all
     POST { menu_item_key, name, yield_qty?, instructions?, lines:[{ingredient_id,qty}] }
     PATCH { id, ...fields, lines? }  → lines, if present, REPLACE the existing set
     DELETE { id } → soft delete
   Cost per serving = sum(line.qty * ingredient.cost_per_unit) / yield_qty — computed
   on read, not stored, so it's always correct after an ingredient's cost changes. */
import { requirePermission } from "../_auth.js";
import { boConfigured, boSelect, boInsert, boUpdate, boDelete, enc } from "../_bo-db.js";

async function withCost(recipe) {
  const ingredientIds = (recipe.lines || []).map((l) => l.ingredient_id);
  if (!ingredientIds.length) return { ...recipe, costPerServing: 0 };
  const ingredients = await boSelect("bo_ingredients", `id=in.(${ingredientIds.map(enc).join(",")})&select=id,name,unit,cost_per_unit`);
  const byId = new Map((ingredients || []).map((i) => [i.id, i]));
  let total = 0;
  const lines = (recipe.lines || []).map((l) => {
    const ing = byId.get(l.ingredient_id);
    const lineCost = Number(l.qty) * Number(ing?.cost_per_unit || 0);
    total += lineCost;
    return { ...l, ingredientName: ing?.name || "(deleted ingredient)", unit: ing?.unit, lineCost };
  });
  return { ...recipe, lines, totalCost: total, costPerServing: recipe.yield_qty ? total / Number(recipe.yield_qty) : total };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!boConfigured()) return res.status(503).json({ error: "not configured" });
  if (!requirePermission(req, res, "food_ops")) return;

  try {
    if (req.method === "GET") {
      const parts = ["active=eq.true", "select=*,lines:bo_recipe_lines(*)"];
      if (req.query?.menu_item_key) parts.push(`menu_item_key=eq.${enc(req.query.menu_item_key)}`);
      const rows = await boSelect("bo_recipes", parts.join("&"));
      const withCosts = await Promise.all((rows || []).map(withCost));
      return res.status(200).json({ rows: withCosts });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      const menuItemKey = String(b.menu_item_key || "").trim();
      const name = String(b.name || "").trim();
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!menuItemKey || !name) return res.status(400).json({ error: "menu_item_key and name required" });
      const [recipe] = await boInsert("bo_recipes", {
        menu_item_key: menuItemKey, name, yield_qty: Number(b.yield_qty) || 1, instructions: b.instructions || null,
      });
      if (lines.length) {
        await boInsert("bo_recipe_lines", lines.map((l) => ({ recipe_id: recipe.id, ingredient_id: l.ingredient_id, qty: Number(l.qty) })));
      }
      const [full] = await boSelect("bo_recipes", `id=eq.${enc(recipe.id)}&select=*,lines:bo_recipe_lines(*)`);
      return res.status(200).json({ ok: true, row: await withCost(full || recipe) });
    }

    if (req.method === "PATCH") {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: "id required" });
      const patch = { updated_at: new Date().toISOString() };
      for (const f of ["name", "yield_qty", "instructions", "active"]) if (b[f] !== undefined) patch[f] = b[f];
      await boUpdate("bo_recipes", `id=eq.${enc(b.id)}`, patch);
      if (Array.isArray(b.lines)) {
        await boDelete("bo_recipe_lines", `recipe_id=eq.${enc(b.id)}`);
        if (b.lines.length) await boInsert("bo_recipe_lines", b.lines.map((l) => ({ recipe_id: b.id, ingredient_id: l.ingredient_id, qty: Number(l.qty) })));
      }
      const [full] = await boSelect("bo_recipes", `id=eq.${enc(b.id)}&select=*,lines:bo_recipe_lines(*)`);
      return res.status(200).json({ ok: true, row: await withCost(full) });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id || req.body?.id;
      if (!id) return res.status(400).json({ error: "id required" });
      const row = await boUpdate("bo_recipes", `id=eq.${enc(id)}`, { active: false });
      return res.status(200).json({ ok: true, row: row?.[0] || row });
    }

    return res.status(405).json({ error: "method" });
  } catch (e) {
    return res.status(502).json({ error: "bo-db error", detail: String(e.message || e) });
  }
}
