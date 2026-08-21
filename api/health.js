/* GET /api/health — "Is the site connected to my backend?" in one call.
   No secrets returned. Reports which data source is live (StoreHub feed /
   MENU_FEED_URL / bundled demo catalog), the product count, and a plain-English
   status so you can confirm the StoreHub link right after deploying.           */
import { getMenu } from "./_menu.js";
import { shConfigured } from "./_storehub.js";
import { posSyncKey } from "./_auth.js";
import { aiProvider } from "./_ai.js";
import {
  usingRedis, storageConfigured, storageUrlUsable, storageFault, storageMode,
  supabaseConfigured, supabaseKeyIsPublishable,
} from "./_store.js";

/* Every variable name the code actually reads, aliases included. Anything in
   the environment that is nearly one of these — but not one of these — is a
   typo, and a typo is invisible: the site behaves exactly as if the variable
   were never set, and the dashboard shows a row that looks perfectly correct.
   SUPABASE_SERVICE_ROLE_KRY cost an evening. Names only are compared and
   reported; a value is never read or echoed. */
const KNOWN_VARS = [
  "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_KEY",
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL",
  "KV_REST_API_TOKEN", "KV_REST_API_READ_ONLY_TOKEN", "KV_URL", "REDIS_URL",
  "REDIS_REST_URL", "REDIS_REST_TOKEN",
  "POS_SYNC_KEY", "WEBSITE_API_KEY", "STAFF_KEY", "MASTER_PIN",
  "ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_SECRET",
  "STOREHUB_STORE", "STOREHUB_TOKEN", "MENU_FEED_URL", "POS_FEED_MAX_AGE_H",
  "XAI_API_KEY", "GROK_MODEL", "GEMINI_API_KEY", "GROQ_API_KEY",
  "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY",
  "AI_PROVIDER", "AI_MODEL", "RESEND_API_KEY",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  "LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET", "LINE_TO",
  "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TO",
  "WHATSAPP_API_VERSION", "WHATSAPP_TEMPLATE_NAME", "WHATSAPP_TEMPLATE_LANGUAGE",
  "OMISE_PUBLIC_KEY", "OMISE_SECRET_KEY", "TWOC2P_MERCHANT_ID",
  "TWOC2P_SECRET", "GBP_SECRET_KEY",
];

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

function misspeltVars() {
  const known = new Set(KNOWN_VARS);
  const out = [];
  for (const name of Object.keys(process.env)) {
    if (known.has(name) || name.length < 8) continue;
    for (const want of KNOWN_VARS) {
      if (Math.abs(name.length - want.length) > 2) continue;
      if (editDistance(name, want) <= 2 && !process.env[want]) {
        out.push({ found: name, meant: want });
        break;
      }
    }
  }
  return out;
}

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
    const prov = aiProvider();
    const ai = {
      brain: Boolean(prov),
      provider: prov?.name || null,   // gemini | groq | openrouter | deepseek | openai | xai
      model: prov?.model || null,
    };
    const wired = {
      posSync: Boolean(posSyncKey()),
      storage: usingRedis(),   // is anything remembering things across restarts?
      storageOn: storageMode(), // "supabase" | "redis" | "memory"
      staffKey: Boolean(process.env.STAFF_KEY),
      ownerLogin: Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && process.env.ADMIN_SECRET),
      promoPin: Boolean(process.env.MASTER_PIN),
      payments: {
        omise: Boolean(process.env.OMISE_PUBLIC_KEY && process.env.OMISE_SECRET_KEY),
        twoc2p: Boolean(process.env.TWOC2P_MERCHANT_ID && process.env.TWOC2P_SECRET),
        gbp: Boolean(process.env.GBP_SECRET_KEY),
      },
      notify: {
        inApp: Boolean(process.env.STAFF_KEY),
        line: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_TO),
        telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        whatsapp: Boolean(
          process.env.WHATSAPP_ACCESS_TOKEN &&
          process.env.WHATSAPP_PHONE_NUMBER_ID &&
          process.env.WHATSAPP_TO
        ),
        whatsappTemplate: Boolean(process.env.WHATSAPP_TEMPLATE_NAME),
        email: Boolean(process.env.RESEND_API_KEY),
      },
    };
    /* Without Upstash every order, member and wallet balance lives in one
       serverless instance's memory and disappears when Vercel recycles it.
       That is worth saying out loud on the page people check to see if the
       site is healthy, because nothing else about the site looks broken. */
    const warnings = [];
    /* First, because a misspelt name explains every other warning below it. */
    for (const { found, meant } of misspeltVars()) {
      warnings.push(
        `⚠️ ${found} is set but nothing reads it — did you mean ${meant}? That one is not set, so the ` +
        "site is behaving as though you never added it. Rename the variable in Vercel, then redeploy.",
      );
    }
    if (!wired.storage) {
      /* "No database" and "database set up wrong" need different next actions,
         and the second one is the one that looks like success from the
         dashboard, so name the actual failure rather than repeating the setup
         advice. */
      if (supabaseKeyIsPublishable()) {
        /* The nastiest of the three, because nothing errors: site_kv has RLS
           on with no policies, so the publishable key reads back 200 OK and
           empty forever and the site looks perfectly connected. */
        warnings.push(
          "⚠️ SUPABASE_SERVICE_ROLE_KEY holds the publishable (anon) key, which cannot see the site's " +
          "data at all — storage is in memory only. Supabase → Project Settings → API Keys → copy the " +
          "secret / service_role key instead (it is the hidden one, starting sb_secret_ or a long token " +
          "ending in a random-looking string). Never put that key in a page — it is server-side only.",
        );
      } else if (storageConfigured() && !storageUrlUsable()) {
        warnings.push(
          supabaseConfigured()
            ? "⚠️ SUPABASE_URL is not a web address — it should start with https:// and end in .supabase.co. " +
              "A postgres:// connection string goes in a different setting; this one wants the Project URL."
            : "⚠️ The Redis URL is not a REST URL — it looks like KV_URL / REDIS_URL (rediss://…), which " +
              "only a Redis client can use. Copy the value labelled KV_REST_API_URL (or UPSTASH_REDIS_REST_URL) " +
              "instead — it starts with https:// — then redeploy. Storage is in memory until then.",
        );
      } else if (storageConfigured() && storageFault()) {
        warnings.push(
          `⚠️ The database is configured but rejecting this site (${storageFault()}) — storage is in memory only. ` +
          (supabaseConfigured()
            ? "A 401 or 404 means the key is wrong or the site_kv table is missing. Check SUPABASE_SERVICE_ROLE_KEY " +
              "was pasted without the surrounding quotes and belongs to the same project as SUPABASE_URL."
            : "A 401 means the token is wrong: check that KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_TOKEN) was " +
              "pasted without the surrounding quotes, is the full value, and belongs to the same database as the URL.") +
          " The site retries every 30 seconds, so fixing the value heals it without a redeploy.",
        );
      } else {
        warnings.push("⚠️ No database — orders, members, wallets and homepage edits are in memory only and will be lost when the server restarts. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or the Upstash Redis pair.");
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
    const whatsappParts = [
      process.env.WHATSAPP_ACCESS_TOKEN,
      process.env.WHATSAPP_PHONE_NUMBER_ID,
      process.env.WHATSAPP_TO,
    ];
    if (whatsappParts.some(Boolean) && !whatsappParts.every(Boolean)) {
      warnings.push(
        "⚠️ WhatsApp order alerts are only partly configured — set WHATSAPP_ACCESS_TOKEN, " +
        "WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TO together, then redeploy.",
      );
    } else if (wired.notify.whatsapp && !wired.notify.whatsappTemplate) {
      warnings.push(
        "⚠️ WhatsApp order alerts are using plain text, which Meta accepts only during an open " +
        "customer-service window. Add an approved utility WHATSAPP_TEMPLATE_NAME for reliable staff alerts.",
      );
    }

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
