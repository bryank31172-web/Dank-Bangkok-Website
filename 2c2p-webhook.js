/* ============================================================
   StoreHub REST API connector — built to the official spec.
     Host: https://api.storehubhq.com   Auth: HTTP Basic
       username = store name (back-office subdomain), e.g. "dankclub"
       password = API token
     Endpoints used:
       GET /stores                 → find the store id
       GET /products               → the catalogue (no images/THC — see below)
       GET /inventory/<storeId>    → live stock (quantityOnHand)
   StoreHub products carry NO photo and NO THC/type, so we parse THC / type /
   weight from the product name (e.g. "EXO - Toad Venom (Hybrid) THC 28-35%")
   and the storefront draws a branded image with genPhoto() when there's no
   picture. Weight variants (½g / 1g / 3.5g / joint) are grouped into one card
   with price tiers. Rate limit: ≤3 calls/sec (we make 3 per refresh).
   ============================================================ */

const BASE  = process.env.STOREHUB_API_BASE || "https://api.storehubhq.com";
const USER  = process.env.STOREHUB_STORE || process.env.STOREHUB_USER || "";
const TOKEN = process.env.STOREHUB_TOKEN || "";
const STORE_ID_ENV = process.env.STOREHUB_STORE_ID || "";

export function shConfigured() { return Boolean(USER && TOKEN); }

async function shGet(path) {
  const auth = "Basic " + Buffer.from(`${USER}:${TOKEN}`).toString("base64");
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: auth, Accept: "application/json" } });
  if (!r.ok) throw new Error(`StoreHub ${path} → ${r.status}`);
  return r.json();
}

export async function shRaw() {
  // debug helper: returns raw payloads so the mapping can be calibrated
  const out = { store: null, products: [], inventory: [] };
  const stores = await shGet("/stores").catch((e) => ({ error: e.message }));
  out.stores = stores;
  const storeId = STORE_ID_ENV || stores?.[0]?.id || stores?.[0]?._id;
  out.storeId = storeId;
  out.products = await shGet("/products").catch((e) => ({ error: e.message }));
  if (storeId) out.inventory = await shGet("/inventory/" + storeId).catch((e) => ({ error: e.message }));
  return out;
}

export async function fetchStoreHubProducts() {
  const products = await shGet("/products");
  let storeId = STORE_ID_ENV;
  if (!storeId) { try { const s = await shGet("/stores"); storeId = s?.[0]?.id || s?.[0]?._id; } catch (_) {} }
  const stock = {};
  if (storeId) {
    try {
      const inv = await shGet("/inventory/" + storeId);
      for (const row of Array.isArray(inv) ? inv : []) stock[row.productId] = row.quantityOnHand;
    } catch (_) {}
  }
  const list = (Array.isArray(products) ? products : products?.data || [])
    .filter((p) => !p.isParentProduct)          // parents aren't sellable; their child SKUs are
    .map((p) => normalize(p, stock))
    .filter(Boolean);
  return groupTiers(list);
}

/* ---- name parsing (THC / type / weight / clean name) ---- */
function parseType(s) {
  const m = /(indica|sativa|hybrid)/i.exec(s || "");
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "Hybrid";
}
function parseTHC(s) {
  const m = /THC\s*[:=]?\s*([\d.]+\s*(?:[-–]\s*[\d.]+)?\s*%?)/i.exec(s || "");
  if (m) return m[1].replace(/\s+/g, "").replace(/%?$/, "%");
  const mg = /(\d+)\s*mg/i.exec(s || "");
  return mg ? mg[1] + "mg" : "";
}
function parseWeight(s) {
  const t = (s || "").toLowerCase();
  if (/3\s*free\s*1|3\+1|3\.5\s*g|eighth/.test(t)) return "3.5g · 3+1 FREE";
  if (/\b7\s*g\b|quarter/.test(t)) return "7g";
  if (/\b28\s*g\b|\boz\b|ounce/.test(t)) return "28g";
  if (/half\s*gram|½|0\.5\s*g/.test(t)) return "½g";
  if (/joint|pre.?roll|มวน/.test(t)) return "1 joint";
  if (/\b1\s*g\b|per\s*gram/.test(t)) return "1g";
  return "";
}
function baseName(s) {
  return (s || "")
    .replace(/^\s*(super\s*exo|exotics?|exo|top\s*shelf|topshelf|top|mid\s*grade|midgrade|mid|premium)\s*[-–:·]\s*/i, "")
    .replace(/\((?:hybrid|indica|sativa)[^)]*\)/ig, "")
    .replace(/THC\s*[:=]?\s*[\d.]+\s*(?:[-–]\s*[\d.]+)?\s*%?/ig, "")
    .replace(/\b(half\s*gram|per\s*roll\s*joint|pre.?roll|1\s*joint|pro\s*3\s*free\s*1|3\s*free\s*1|3\.5\s*g|½\s*g|1\s*g|7\s*g|28\s*g|per\s*gram)\b/ig, "")
    .replace(/[-–·|(),]+\s*$/g, "")
    .replace(/^\s*[-–·|]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim() || (s || "").trim();
}
const gradeFromName = (s) => {
  const t = (s || "").toLowerCase();
  if (/super\s*exo|premium|moon\s*rock|kaws/.test(t)) return "Premium";
  if (/\bexo\b|exotic/.test(t)) return "Exotics";
  if (/top\s*shelf|topshelf|\btop\b/.test(t)) return "Topshelf";
  if (/mid\s*grade|midgrade|\bmid\b/.test(t)) return "Midgrade";
  return null;
};
function mapCategory(p) {
  const s = ((p.category||"")+" "+(p.subCategory||"")+" "+(p.tags||[]).join(" ")+" "+p.name).toLowerCase();
  const g = gradeFromName(s); if (g) return g;
  if (/edible|gummy|gummies|choc|cookie|brownie|jelly|sour|oil|tincture/.test(s)) return "Edibles";
  if (/vape|dab|wax|resin|rosin|cart|disposable|diamond|concentrate/.test(s)) return "Vapes";
  if (/beer|lager|soda|drink|beverage/.test(s)) return "Beer";
  if (/paper|grinder|bong|lighter|clipper|tray|raw|accessor|equipment/.test(s)) return "Accessories";
  if (/shirt|tee|hoodie|cap|merch/.test(s)) return "Merch";
  if (/flower|bud|kush|gelato|haze|diesel|zkittle|cake|og\b/.test(s)) return "Exotics";
  return (p.category || "Exotics");
}

function normalize(p, stock) {
  const nm = p.name || p.title; if (!nm) return null;
  const category = mapCategory(p);
  const flower = ["Exotics","Topshelf","Midgrade","Premium"].includes(category);
  const st = stock[p.id] != null ? Number(stock[p.id]) : (p.trackStockLevel ? 0 : 999);
  return {
    shId: p.id,
    id: String(p.sku || p.id).replace(/\s+/g, "-").toLowerCase(),
    name: baseName(nm) || nm,
    rawName: nm,
    category,
    type: parseType(nm + " " + (p.tags||[]).join(" ")),
    thcLabel: parseTHC(nm),
    thc: parseFloat(parseTHC(nm)) || 0,
    cbd: 0,
    unit: flower ? "g" : "pc",
    stock: st,
    price: Number(p.unitPrice) || 0,
    member: p.unitPrice ? Math.round(Number(p.unitPrice) * 0.9) : undefined,
    image: p.imageUrl || p.image || "",   // usually empty on StoreHub → genPhoto fallback
    featured: (p.tags||[]).includes("featured"),
    freeGift: (p.tags||[]).map(x=>String(x).toLowerCase()).includes("freegift"),
    effects: [], flavors: [],
    description: p.description || "",
    _weight: flower ? parseWeight(nm) : "",
    _base: baseName(nm).toLowerCase(),
  };
}

/* group weight variants of the same strain into one card with price tiers */
function groupTiers(list) {
  const order = ["½g","1 joint","1g","3.5g · 3+1 FREE","7g","28g"];
  const groups = {};
  const singles = [];
  for (const p of list) {
    if (p._weight && p.unit === "g") {
      const key = p._base + "|" + p.category;
      (groups[key] = groups[key] || []).push(p);
    } else singles.push(p);
  }
  const out = [...singles];
  for (const key in groups) {
    const g = groups[key];
    if (g.length === 1) { const p = g[0]; if (p._weight) { p.price = p.price; } out.push(stripTierMeta(p)); continue; }
    const head = { ...g[0] };
    head.priceTiers = g
      .map((x) => ({ label: x._weight, price: x.price, member: x.member || Math.round(x.price*0.9), shId: x.shId }))
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    head.stock = Math.max(...g.map((x) => x.stock));
    head.freeGift = g.some((x) => x.freeGift);
    head.featured = g.some((x) => x.featured);
    delete head.price; delete head.member;
    out.push(stripTierMeta(head));
  }
  return out;
}
function stripTierMeta(p) { const { _weight, _base, rawName, ...rest } = p; return rest; }

/* ---- optional: push an online order into StoreHub as a transaction ---- */
export async function pushTransaction(order, orderId) {
  if (!shConfigured() || process.env.STOREHUB_PUSH_ORDERS !== "1") return { skipped: true };
  let storeId = STORE_ID_ENV;
  if (!storeId) { try { const s = await shGet("/stores"); storeId = s?.[0]?.id; } catch (_) {} }
  if (!storeId) return { skipped: true };
  const items = (order.items || []).filter((i) => i.shId).map((i) => ({
    productId: i.shId, quantity: i.qty, unitPrice: i.price, total: i.lineTotal,
  }));
  if (!items.length) return { skipped: true, reason: "no productId mapping" };
  const body = {
    refId: orderId, storeId, transactionType: "Sale",
    transactionTime: new Date().toISOString(),
    total: order.total, subTotal: order.subtotal, discount: order.discount || 0,
    channel: "ONLINE_PAYMENTS", items,
    payments: [{ paymentMethod: order.payment === "Card" ? "CreditCard" : order.payment === "Wallet" ? "Loyalty" : "Cash", amount: order.total }],
    contactDetail: { name: order.customer?.name, phone: order.customer?.phone },
    shippingType: order.fulfilment === "delivery" ? "delivery" : "pickup",
  };
  const auth = "Basic " + Buffer.from(`${USER}:${TOKEN}`).toString("base64");
  const r = await fetch(`${BASE}/transactions`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status };
}
