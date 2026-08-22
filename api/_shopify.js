/* Push a website order into the Shopify admin at dankbkk.com.

   Env:
     SHOPIFY_STORE          the myshopify domain. The shop handle is
                            "dankclubbkk", so this is almost certainly
                            "dankclubbkk.myshopify.com" — confirm it in
                            Settings → Domains, which names it outright.
                            The public domain (dankbkk.com) is NOT the API
                            host and a wrong value here answers 404.
     SHOPIFY_ADMIN_TOKEN    Admin API access token from a custom app,
                            starts "shpat_". Needs the write_orders scope.
     SHOPIFY_API_VERSION    optional, default below.
     SHOPIFY_ORDER_TAGS     optional extra tags, comma-separated.

   Unset any of the first two and this does nothing at all — same contract as
   the LINE and WhatsApp helpers, so a shop with no Shopify keeps working and
   the checkout never notices.

   GraphQL rather than /admin/api/…/orders.json: Shopify has been moving the
   Admin API off REST since 2024 and new versions drop endpoints, so the
   mutation is the one that will still be there next year.

   Lines are sent as custom line items — a title, a quantity and a price —
   not as links to Shopify products. The till is the source of truth for what
   the shop sells; matching each line to a Shopify variant would need the two
   catalogues to agree on every SKU, and when they disagreed the order would
   fail rather than arrive. The consequence is that Shopify records the sale
   but does not move its own stock. That is the right trade while the POS owns
   inventory. If the catalogues are ever reconciled, add a variant lookup here
   and Shopify's stock starts moving too. */

const API_VERSION = String(process.env.SHOPIFY_API_VERSION || "2025-07").trim();

const store = () => String(process.env.SHOPIFY_STORE || "")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "");

const token = () => String(process.env.SHOPIFY_ADMIN_TOKEN || "").trim();

export const shopifyConfigured = () => Boolean(store() && token());

const MUTATION = `
mutation createOrder($order: OrderCreateOrderInput!) {
  orderCreate(order: $order) {
    order { id name legacyResourceId }
    userErrors { field message }
  }
}`;

/* Fields that make the order nicer to read in the admin but are not the order:
   the sales-channel label, the discount code, the shipping line, the address.
   If Shopify's schema disagrees with any of them on the version the shop is
   pinned to, the whole mutation is refused and the sale never arrives — so a
   rejection that looks like a schema complaint is retried without them.

   This exists because the Shopify API cannot be reached from where this was
   written to check field by field. Getting a plainer order is a much better
   failure than getting none. */
const OPTIONAL_FIELDS = ["sourceName", "discountCode", "shippingLines", "billingAddress", "customAttributes", "tags"];
const SCHEMA_COMPLAINT = /is not defined|isn't defined|unknown field|invalid value|InvalidValue|not a valid|argument|coerce/i;

/* Shopify rejects the whole order if the phone field is not a phone, and a
   table order carries "TABLE-T3" there on purpose (see api/order.js). So a
   value only travels as a phone number when it looks like one; otherwise it
   is dropped and the table name is already in the note. */
function realPhone(v) {
  const digits = String(v || "").replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return "";
  if (/^0/.test(digits)) return "+66" + digits.slice(1);   // Thai local -> E.164
  return "+" + digits;
}

function money(n) {
  const v = Number(n);
  return (Number.isFinite(v) ? Math.max(0, v) : 0).toFixed(2);
}

/* What the shop needs to read in the Shopify admin that the line items do not
   already say: how it is being paid, where it is going, and any note. */
function buildNote(o, orderId, table) {
  const where = table
    ? `Table ${table}`
    : o.fulfilment === "delivery"
    ? `Delivery — ${o.delivery?.zone || ""} ${o.delivery?.address || ""}`.trim()
    : `Pickup — ${o.pickup?.branch || ""}${o.pickup?.time ? " at " + o.pickup.time : ""}`;
  const bits = [
    `Order ${orderId} from dankbangkok.com`,
    `Pay: ${o.payment || "-"}`,
    where,
    o.promo ? `Code: ${o.promo}` : "",
    o.member ? "Member price" : "",
    o.box?.boxes ? `Custom box x${o.box.boxes} (${o.box.grams}g)` : "",
    o.notes ? `Notes: ${o.notes}` : "",
  ].filter(Boolean);
  return bits.join("\n").slice(0, 5000);
}

function buildLines(o) {
  const lines = (o.items || []).map((i) => {
    const qty = Math.max(1, Math.round(Number(i.qty) || 1));
    /* lineTotal is what the customer was charged for the row, so the unit
       price is that divided by the quantity — sending lineTotal as the unit
       price would multiply the order by the quantity a second time. */
    const unit = Number(i.lineTotal) / qty;
    const title = [i.name, i.option].filter(Boolean).join(" · ").slice(0, 250);
    return {
      title: title || "Item",
      quantity: qty,
      requiresShipping: false,
      priceSet: { shopMoney: { amount: money(unit), currencyCode: "THB" } },
      ...(i.sku || i.shId ? { sku: String(i.sku || i.shId).slice(0, 60) } : {}),
    };
  });
  /* Free box gifts ride along at ฿0 so the packing list in Shopify matches
     what actually leaves the shop. */
  for (const g of o.box?.gifts || []) {
    lines.push({
      title: `🎁 ${String(g.label || g.id).slice(0, 240)}`,
      quantity: Math.max(1, Math.round(Number(g.qty) || 1)),
      requiresShipping: false,
      priceSet: { shopMoney: { amount: "0.00", currencyCode: "THB" } },
    });
  }
  return lines;
}

/**
 * Create the order in Shopify. Never throws: a Shopify that is down, wrong or
 * simply not configured must not cost a sale, so every failure comes back as
 * {ok:false} for the caller to record alongside the other channels.
 */
export async function pushShopifyOrder(o, orderId, table) {
  if (!shopifyConfigured()) return { ok: false, skipped: true };

  const lineItems = buildLines(o);
  if (!lineItems.length) return { ok: false, skipped: true };

  const phone = realPhone(o.customer?.phone);
  const name = String(o.customer?.name || "").trim().slice(0, 100);
  const discount = Math.max(0, Number(o.discount) || 0);
  const fee = Math.max(0, Number(o.deliveryFee) || 0);

  const tags = ["dankbangkok.com", o.fulfilment || "order"]
    .concat(o.member ? ["member"] : [])
    .concat(String(process.env.SHOPIFY_ORDER_TAGS || "").split(",").map((s) => s.trim()))
    .filter(Boolean)
    .slice(0, 20);

  const order = {
    /* Shopify keeps its own order numbering; this is the reference staff read
       back to a customer over the phone, so it goes where they will see it. */
    note: buildNote(o, orderId, table),
    /* The admin's Orders list shows this in its own column, so staff can tell
       a dankbangkok.com order from a dankbkk.com one without opening either. */
    sourceName: "dankbangkok.com",
    tags,
    email: String(o.customer?.email || "").trim() || undefined,
    phone: phone || undefined,
    currency: "THB",
    lineItems,
    /* Nothing is captured here — the shop takes cash, PromptPay or a wallet at
       the counter — so the order lands unpaid and staff mark it paid when the
       money is actually in. Claiming otherwise would put fictional revenue in
       Shopify's reports. */
    financialStatus: "PENDING",
    customAttributes: [{ key: "dank_order_id", value: orderId }],
    ...(discount
      ? { discountCode: { itemFixedDiscountCode: {
            code: String(o.promo || "DISCOUNT").slice(0, 40),
            amountSet: { shopMoney: { amount: money(discount), currencyCode: "THB" } },
          } } }
      : {}),
    ...(fee
      ? { shippingLines: [{
            title: `Delivery${o.delivery?.zone ? " — " + o.delivery.zone : ""}`.slice(0, 100),
            priceSet: { shopMoney: { amount: money(fee), currencyCode: "THB" } },
          }] }
      : {}),
    ...(name || phone
      ? { billingAddress: {
            firstName: name || "Guest",
            address1: String(o.delivery?.address || "").slice(0, 250) || "-",
            city: "Bangkok",
            countryCode: "TH",
            ...(phone ? { phone } : {}),
          } }
      : {}),
  };

  const first = await send(order);
  if (first.ok || !first.retryPlain) return first;

  /* Second and last attempt: the order itself, nothing decorative. */
  const plain = { ...order };
  for (const f of OPTIONAL_FIELDS) delete plain[f];
  console.error("shopify: retrying without", OPTIONAL_FIELDS.join(", "));
  const second = await send(plain);
  if (second.ok) return { ...second, degraded: true };
  return second;
}

async function send(order) {
  try {
    const r = await fetch(`https://${store()}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: MUTATION, variables: { order } }),
    });
    if (!r.ok) {
      /* 401 means the token is wrong or the app lacks write_orders; 404 means
         SHOPIFY_STORE is not the myshopify domain. Both are silent otherwise,
         and both are the mistakes that actually happen. Neither is worth a
         retry — the second attempt would fail identically. */
      console.error("shopify order failed:", r.status, r.statusText);
      return { ok: false, status: r.status };
    }
    const j = await r.json().catch(() => ({}));
    /* GraphQL answers 200 for a rejected mutation, so the body is where the
       real outcome is. Without this a bad order looked like a success.
       Top-level `errors` means the request itself was malformed — a bad field
       name lands here; `userErrors` means Shopify understood and declined. */
    const errs = (j.errors || []).concat(j.data?.orderCreate?.userErrors || []);
    if (errs.length) {
      const text = JSON.stringify(errs).slice(0, 500);
      console.error("shopify order rejected:", text);
      return { ok: false, userErrors: errs, retryPlain: SCHEMA_COMPLAINT.test(text) };
    }
    const made = j.data?.orderCreate?.order;
    if (!made) { console.error("shopify order: no order returned"); return { ok: false }; }
    return { ok: true, shopifyOrder: made.name, shopifyId: made.legacyResourceId };
  } catch (e) {
    console.error("shopify order threw:", e.message);
    return { ok: false };
  }
}
