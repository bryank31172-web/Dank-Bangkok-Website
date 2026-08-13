/* GET /api/health — "Is the site connected to my backend?" in one call.
   No secrets returned. Reports which data source is live (StoreHub feed /
   MENU_FEED_URL / bundled demo catalog), the product count, and a plain-English
   status so you can confirm the StoreHub link right after deploying.           */
import { getMenu } from "./_menu.js";
import { shConfigured } from "./_storehub.js";
import { posSyncKey } from "./_auth.js";
import { usingRedis, storageConfigured, storageUrlUsable, storageFault } from "./_store.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    const menu = await getMenu(true); // force a fresh upstream read
    const source = menu.source; // "storehub" | "feed" | "bundled" | "empty"
    const count = (menu.data || []).length;
    const shSet = shConfigured();
    /* "pos" is BRYAN POS's own push feed — the freshest source there is, and
       the one actually in use. It was missing from this list, so a perfectly
       healthy site reported itself as not connected and blamed StoreHub. */
    const connected = source === "pos" || source === "storehub" || source === "feed";

    let status, detail;
    if (source === "pos") {
      status = "connected";
      detail = `✅ Connected to BRYAN POS — ${count} live products pushed from the till.`;
    } else if (source === "storehub") {
      status = "connected";
      detail = `✅ Connected to StoreHub — ${count} live products loading from your POS backend.`;
    } else if (source === "feed") {
      status = "connected";
      detail = `✅ Connected to your custom feed (MENU_FEED_URL) — ${count} products.`;
    } else if (shSet) {
      status = "configured-but-not-loading";
      detail =
        "⚠️ StoreHub credentials ARE set on this deployment, but the live fetch " +
        "returned no products — the site is falling back to the built-in catalog. " +
        "Check the token/store name, or that API access is enabled on the StoreHub account.";
    } else {
      status = "not-connected";
      detail =
        "❌ Not connected to StoreHub yet — the site is showing its built-in demo " +
        "catalog. Add STOREHUB_STORE and STOREHUB_TOKEN in your Vercel project's " +
        "Environment Variables, then redeploy.";
    }

    const sample = (menu.data || []).slice(0, 5).map((p) => ({
      code: p.code || "",
      name: p.name,
      stock: p.stock,
      price: p.price ?? p.priceTiers?.[0]?.price ?? null,
    }));

    /* Booleans only. Whether a key is set is a deployment fact worth being
       able to check from a phone; the key itself is not, and this endpoint is
       public. Never widen this to echo a value. */
    const ai = {
      brain: Boolean(process.env.XAI_API_KEY),
      model: process.env.GROK_MODEL || "grok-4",
    };
    const wired = {
      posSync: Boolean(posSyncKey()),
      storage: usingRedis(),   // true for the Upstash names OR Vercel's KV_ ones
      staffKey: Boolean(process.env.STAFF_KEY),
      ownerLogin: Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && process.env.ADMIN_SECRET),
      promoPin: Boolean(process.env.MASTER_PIN),
      payments: {
        omise: Boolean(process.env.OMISE_PUBLIC_KEY && process.env.OMISE_SECRET_KEY),
        twoc2p: Boolean(process.env.TWOC2P_MERCHANT_ID && process.env.TWOC2P_SECRET),
        gbp: Boolean(process.env.GBP_SECRET_KEY),
      },
      notify: {
        telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        email: Boolean(process.env.RESEND_API_KEY),
      },
    };
    /* Without Upstash every order, member and wallet balance lives in one
       serverless instance's memory and disappears when Vercel recycles it.
       That is worth saying out loud on the page people check to see if the
       site is healthy, because nothing else about the site looks broken. */
    const warnings = [];
    if (!wired.storage) {
      /* "No Redis" and "Redis set up wrong" need different next actions, and
         the second one is the one that looks like success from the dashboard,
         so name the actual failure rather than repeating the setup advice. */
      if (storageConfigured() && !storageUrlUsable()) {
        warnings.push(
          "⚠️ The Redis URL is not a REST URL — it looks like KV_URL / REDIS_URL (rediss://…), which " +
          "only a Redis client can use. Copy the value labelled KV_REST_API_URL (or UPSTASH_REDIS_REST_URL) " +
          "instead — it starts with https:// — then redeploy. Storage is in memory until then.",
        );
      } else if (storageConfigured() && storageFault()) {
        warnings.push(
          `⚠️ Redis is configured but rejecting this site (${storageFault()}) — storage is in memory only. ` +
          "A 401 means the token is wrong: check that KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_TOKEN) was " +
          "pasted without the surrounding quotes, is the full value, and belongs to the same database as the URL. " +
          "The site retries every 30 seconds, so fixing the value heals it without a redeploy.",
        );
      } else {
        warnings.push("⚠️ No Redis — orders, members, wallets and homepage edits are in memory only and will be lost when the server restarts. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, or install Upstash from the Vercel Marketplace (KV_REST_API_URL + KV_REST_API_TOKEN are accepted too).");
      }
    }
    /* Without Redis the POS's pushed catalogue lives in one instance's memory,
       so whether a shopper sees the till's 383 products or the older bundled
       list depends on which server happens to answer them. That looks like the
       shop randomly losing stock, so it is worth naming separately. */
    if (!wired.storage && source === "pos") {
      warnings.push(
        "⚠️ The POS catalogue is only held in memory, so some visitors will see the built-in " +
        "list instead of the till's live one. Fixing Redis above fixes this too.",
      );
    }
    if (!wired.posSync) warnings.push("⚠️ POS_SYNC_KEY not set (WEBSITE_API_KEY also accepted) — BRYAN POS cannot push its menu or drive the customer display.");

    return res.status(200).json({
      ok: true,
      connected,
      status,
      detail,
      source,
      products: count,
      storehubConfigured: shSet,
      ai,
      wired,
      warnings,
      updated: new Date(menu.at || Date.now()).toISOString(),
      sample,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, connected: false, status: "error", detail: String(e.message || e) });
  }
}
