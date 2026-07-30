/* /api/admin — owner login + manual catalog editing (products / inventory /
   prices / promotions) straight from the website.

     POST {action:"login", email, password}    → {ok, token}   (7-day session)
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

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// Read at call time, not at import time: a missing variable has to become a
// clean 503 from the handler, never a throw while the route is being loaded.
const EMAIL = () => String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const PASS_HASH = () => sha256(process.env.ADMIN_PASSWORD || "");
const SECRET = () => process.env.ADMIN_SECRET || "";
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

function makeToken() {
  const payload = b64u(JSON.stringify({ e: EMAIL(), x: Date.now() + TTL_MS }));
  return payload + "." + sign(payload);
}
function verifyToken(tok) {
  // No signing secret means no valid tokens, rather than tokens signed with "".
  if (!SECRET()) return false;
  if (!tok || typeof tok !== "string" || tok.indexOf(".") < 0) return false;
  const i = tok.indexOf(".");
  const payload = tok.slice(0, i), sig = tok.slice(i + 1);
  if (!safeEq(sig, sign(payload))) return false;
  try {
    const p = JSON.parse(b64uDecode(payload));
    return !!p.x && Date.now() < p.x;
  } catch (e) { return false; }
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

  // Everything past the public GET needs a real, deployment-supplied login.
  if (!requireEnv(res, ["ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_SECRET"])) return;

  const b = req.body || {};

  if (b.action === "login") {
    const okEmail = String(b.email || "").trim().toLowerCase() === EMAIL();
    const okPass = safeEq(sha256(b.password || ""), PASS_HASH());
    if (!okEmail || !okPass) return res.status(401).json({ error: "wrong email or password" });
    return res.status(200).json({ ok: true, token: makeToken() });
  }

  // everything below needs a valid signed session
  if (!verifyToken(b.token)) return res.status(401).json({ error: "session expired — log in again" });

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
  if (b.action === "verify") return res.status(200).json({ ok: true, valid: true });

  if (b.action === "save") {
    const ov = b.overrides || {};
    const clean = {
      products: typeof ov.products === "object" && ov.products ? ov.products : {},
      added: Array.isArray(ov.added) ? ov.added.slice(0, 200) : [],
      promos: typeof ov.promos === "object" && ov.promos ? ov.promos : {},
    };
    await setJSON("admin:overrides", clean, 60 * 60 * 24 * 365);
    try { await bustMenu(); } catch (e) {}
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: "unknown action" });
}
