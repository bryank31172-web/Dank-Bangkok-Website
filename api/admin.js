/* /api/admin — owner login + manual catalog editing (products / inventory /
   prices / promotions) straight from the website.

     POST {action:"login", email, password}    → {ok, token}   (7-day session)
     POST {action:"pin", pin}                  → {ok, token, scope:"promo"}
     POST {action:"save", token, overrides}    → {ok}          (stores edits, busts menu cache)
     POST {action:"logout", token}             → {ok}
     GET                                       → {ok, overrides}  (public — this is menu data)

   Overrides shape (all optional):
     { products:{ [id]: {name,price,member,stock,thcLabel,category,type,_hidden,priceTiers} },
       added:[ full product objects created by the owner ],
       promos:{ CODE:{type:"pct"|"fixed"|"freedelivery", value, min, desc} } }

   The live menu (api/_menu.js) applies these on top of whatever source is
   active (StoreHub / feed / bundled), so edits show for every customer within
   the normal ~30s refresh — instantly after the save busts the cache.

   SECURITY
   --------
   • Sessions are stateless, signed tokens (HMAC-SHA256). No shared session
     store is needed, so login keeps working even if Redis is unavailable.
   • The owner login is ENTIRELY environment-supplied. All three of these must
     be set or the endpoint refuses to log anyone in:
        ADMIN_EMAIL      – owner email
        ADMIN_PASSWORD   – plaintext password (only its SHA-256 is kept in memory)
        ADMIN_SECRET     – token signing secret
     A fourth, MASTER_PIN, is optional. It is a shorter door onto ONE thing:
     the promotions editor. A six-digit PIN is not a password — a machine can
     try all million in seconds — so it is never stored in, or compared in,
     the browser. It is checked here, against the environment, in constant
     time, behind a rate limit, and the token it hands back is stamped
     s:"promo". A promo token can add, change and delete promotions; it can
     never touch a product, a price or the stock, because "save" refuses to
     apply anything but promos when the scope is not the owner's. If
     MASTER_PIN is unset the action answers 503 rather than letting anybody
     in — the same rule every other secret here follows.

     They used to have defaults baked in here: the email, a hash of the
     password, and — worst of the three — a signing secret derived from those
     two. A derived secret is not a secret. Anyone with a copy of this file
     could compute it, mint themselves a valid 7-day owner token offline and
     rewrite the whole catalogue without ever seeing the password.
   NOTE: saving edits still needs the Upstash Redis env vars
   (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) so overrides persist
   across serverless instances — the same store the wallet/chat already use.  */
import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";
import { bustMenu } from "./_menu.js";
import { requireEnv } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// Read at call time, not at import time: a missing variable has to become a
// clean 503 from the handler, never a throw while the route is being loaded.
const EMAIL = () => String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const PASS_HASH = () => sha256(process.env.ADMIN_PASSWORD || "");
const SECRET = () => process.env.ADMIN_SECRET || "";
const PIN = () => String(process.env.MASTER_PIN || "").trim();
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uDecode = (s) =>
  Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const safeEq = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const sign = (payload) => b64u(crypto.createHmac("sha256", SECRET()).update(payload).digest());

/* scope: "owner" (email+password) or "promo" (master PIN). A PIN session is
   deliberately shorter than a week — it is meant for handing a number to
   whoever is running the promotion today, not for leaving signed in. */
const PIN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function makeToken(scope) {
  const s = scope === "promo" ? "promo" : "owner";
  const ttl = s === "promo" ? PIN_TTL_MS : TTL_MS;
  const payload = b64u(JSON.stringify({ e: s === "promo" ? "pin" : EMAIL(), x: Date.now() + ttl, s }));
  return payload + "." + sign(payload);
}
/* Returns the decoded payload for a good token, or null. Callers that only
   want yes/no can read it as truthy; callers that care about what the token
   is allowed to do read .s off it. */
function readToken(tok) {
  // No signing secret means no valid tokens, rather than tokens signed with "".
  if (!SECRET()) return null;
  if (!tok || typeof tok !== "string" || tok.indexOf(".") < 0) return null;
  const i = tok.indexOf(".");
  const payload = tok.slice(0, i), sig = tok.slice(i + 1);
  if (!safeEq(sig, sign(payload))) return null;
  try {
    const p = JSON.parse(b64uDecode(payload));
    if (!p.x || Date.now() >= p.x) return null;
    return { e: p.e, x: p.x, s: p.s === "promo" ? "promo" : "owner" };
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    const ov = (await getJSON("admin:overrides")) || {};
    return res.status(200).json({ ok: true, overrides: ov });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const b = req.body || {};

  /* The PIN door. Handled before the owner-login env check because it needs a
     different pair of variables, and rate-limited hard: six digits is a small
     enough space that an unthrottled endpoint would be walked through in an
     afternoon. Wrong PINs cost an attempt; a correct one does not reset the
     counter either, which is fine — staff type it once a day. */
  if (b.action === "pin") {
    if (!requireEnv(res, ["ADMIN_SECRET", "MASTER_PIN"])) return;
    if (!(await requireRate(req, res, "adminpin", 8, 900))) return;
    const given = String(b.pin || "").replace(/[^0-9]/g, "");
    if (!given || !safeEq(given, PIN())) return res.status(401).json({ error: "wrong PIN" });
    return res.status(200).json({ ok: true, token: makeToken("promo"), scope: "promo" });
  }

  // Everything past the public GET needs a real, deployment-supplied login.
  if (!requireEnv(res, ["ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_SECRET"])) return;

  if (b.action === "login") {
    const okEmail = String(b.email || "").trim().toLowerCase() === EMAIL();
    const okPass = safeEq(sha256(b.password || ""), PASS_HASH());
    if (!okEmail || !okPass) return res.status(401).json({ error: "wrong email or password" });
    return res.status(200).json({ ok: true, token: makeToken("owner") });
  }

  // everything below needs a valid signed session
  const sess = readToken(b.token);
  if (!sess) return res.status(401).json({ error: "session expired — log in again" });

  if (b.action === "logout") {
    // stateless tokens — the client just drops it; nothing to revoke server-side
    return res.status(200).json({ ok: true });
  }

  /* "Is this token still good?" — the read-only question the storefront needs on
     boot. It kept the owner token in localStorage and trusted it on sight, so
     anything sitting in dank_admintok (expired, hand-typed, left behind on a
     shared phone) dropped the page straight into owner mode. No stranger could
     ever SAVE with it — every write above is checked — but the editing bar and
     the hidden products appeared over the shop, and an evening of edits made
     against a dead session was lost the moment Save was pressed. Reaching this
     line at all means verifyToken() passed. */
  if (b.action === "verify") return res.status(200).json({ ok: true, valid: true, scope: sess.s });

  if (b.action === "save") {
    const ov = b.overrides || {};
    const clean = {
      products: typeof ov.products === "object" && ov.products ? ov.products : {},
      added: Array.isArray(ov.added) ? ov.added.slice(0, 200) : [],
      promos: typeof ov.promos === "object" && ov.promos ? ov.promos : {},
      site: typeof ov.site === "object" && ov.site
        ? { hero: typeof ov.site.hero === "object" && ov.site.hero ? ov.site.hero : undefined,
            slides: Array.isArray(ov.site.slides) ? ov.site.slides.slice(0, 8) : undefined }
        : null,
    };
    /* A PIN session may rewrite the promotions and nothing else. It does not
       matter what its browser posted — the catalogue half of the payload is
       thrown away and the stored one kept, so a tampered request cannot move
       a price. This is the whole reason the token carries a scope. */
    if (sess.s !== "owner") {
      const prev = (await getJSON("admin:overrides")) || {};
      clean.products = typeof prev.products === "object" && prev.products ? prev.products : {};
      clean.added = Array.isArray(prev.added) ? prev.added : [];
      clean.site = typeof prev.site === "object" && prev.site ? prev.site : null;
    }
    await setJSON("admin:overrides", clean, 60 * 60 * 24 * 365);
    try { await bustMenu(); } catch (e) {}
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "unknown action" });
}
