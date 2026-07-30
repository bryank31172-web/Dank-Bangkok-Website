/* /api/pos-feed — live menu receiver for BRYAN POS (dank-medical-pos-app).

   The POS runs in the staff device's browser (its data lives there), so it
   PUSHES the catalog here whenever products/stock/prices change (~45s watch):

     POST {key, products:[{id,name,category,type,thc,cbd,unit,stock,price,member,img,sku}]}
          → {ok, count}       (stores normalized feed, busts the menu cache)
     GET  → {ok, at, ageSeconds, count}   (check the connection is alive)

   api/_menu.js reads this feed FIRST (source "pos"), so the website mirrors
   the POS within ~30s of any change. A feed older than POS_FEED_MAX_AGE_H
   (default 72h) is ignored and the site falls back to StoreHub/bundled.

   Auth: shared link key, POS_SYNC_KEY, which must be set on this deployment
   and pasted into POS Settings → Website connection. There used to be a
   default baked into both sides "so it works with zero setup" — which also
   meant anyone holding a copy of the source could replace the entire shop
   catalogue, prices included, on any deployment that never set the variable.
   With it unset the endpoint now rejects every push instead.

   Flower mapping: POS sells flowers per-gram (unit "g", price = 1g). The
   website shows weight tiers, derived exactly from DANK's price card:
   ½g = price/2 · 1g = price · 3.5g bulk = 3×price (the 3+1 deal), with
   member prices from the POS mPrice (≈10% off).                             */
import { getJSON, setJSON } from "./_store.js";
import { bustMenu } from "./_menu.js";
import { requireEnv, safeEq } from "./_auth.js";
import { normPhone as digits } from "./_phone.js";

const MAX_ITEMS = 1000;

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const looksLikeImg = (s) => /^(https?:|data:image)/.test(String(s || ""));

function normalize(list) {
  const out = [];
  for (let i = 0; i < Math.min(list.length, MAX_ITEMS); i++) {
    const p = list[i];
    if (!p || typeof p !== "object" || !p.name) continue;
    const price = num(p.price);
    const member = num(p.member) || Math.round(price * 0.9);
    const item = {
      id: String(p.id ?? p.sku ?? "pos-" + i),
      name: String(p.name),
      category: String(p.category || "Other"),
      type: ["Indica", "Sativa", "Hybrid"].includes(p.type) ? p.type : "Hybrid",
      thc: num(p.thc),
      thcLabel: num(p.thc) > 0 ? num(p.thc) + "%" : "",
      cbd: num(p.cbd),
      stock: p.stock === undefined ? 99 : num(p.stock),
      unit: String(p.unit || "pc"),
      image: looksLikeImg(p.img) ? String(p.img) : "",
      description: "",
      effects: [],
      flavors: [],
    };
    if (item.unit === "g" && price > 0) {
      // POS price is per 1g — derive DANK's standard weight tiers
      item.priceTiers = [
        { label: "½g", price: Math.round(price / 2), member: Math.round(member / 2) },
        { label: "1g", price, member },
        { label: "3.5g bulk", price: price * 3, member: member * 3 },
      ];
    } else {
      item.price = price;
      item.member = member;
    }
    out.push(item);
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    const rec = (await getJSON("pos:feed")) || null;
    const crm = (await getJSON("pos:customers")) || null;
    if (!rec) return res.status(200).json({ ok: true, connected: false, count: 0, crmCount: crm ? crm.list.length : 0 });
    return res.status(200).json({
      ok: true, connected: true, at: rec.at,
      ageSeconds: Math.round((Date.now() - rec.at) / 1000),
      count: (rec.products || []).length,
      crmCount: crm ? crm.list.length : 0,
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  if (!requireEnv(res, ["POS_SYNC_KEY"])) return;
  const b = req.body || {};
  const key = b.key || req.headers["x-api-key"] || "";
  if (!safeEq(key, process.env.POS_SYNC_KEY)) return res.status(401).json({ error: "bad key" });

  if (!Array.isArray(b.products) || !b.products.length) {
    return res.status(400).json({ error: "products must be a non-empty array" });
  }
  const products = normalize(b.products);
  if (!products.length) return res.status(400).json({ error: "no valid products" });

  await setJSON("pos:feed", { at: Date.now(), products }, 60 * 60 * 24 * 30);

  // optional CRM slice from the POS — lets shop members log in on the website
  let crmCount = 0;
  if (Array.isArray(b.customers) && b.customers.length) {
    // Same normaliser as the wallet and the member list — the `d` field written
    // here is what /api/member matches a login against, so it has to agree.
    const list = b.customers.slice(0, 2000)
      .map((c) => ({ id: c.id, name: String(c.name || ""), phone: String(c.phone || ""), d: digits(c.phone), points: Number(c.points) || 0, visits: Number(c.visits) || 0 }))
      .filter((c) => c.d.length >= 6);
    if (list.length) {
      await setJSON("pos:customers", { at: Date.now(), list }, 60 * 60 * 24 * 90);
      crmCount = list.length;
    }
  }

  try { await bustMenu(); } catch (e) {}
  return res.status(200).json({ ok: true, count: products.length, crmCount });
}
