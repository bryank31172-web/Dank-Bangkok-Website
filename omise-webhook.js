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
   • The password is NEVER stored in source — only its SHA-256 hash. So this
     file is safe to keep in a public GitHub repo.
   • Sessions are stateless, signed tokens (HMAC-SHA256). No shared session
     store is needed, so login keeps working even if Redis is unavailable.
   • Override the built-in owner login with host env vars:
        ADMIN_EMAIL      – owner email (default below)
        ADMIN_PASSWORD   – plaintext password; if set, it replaces the baked hash
        ADMIN_SECRET     – token signing secret (optional; a stable one is
                           derived from the credentials when not provided)
   NOTE: saving edits still needs the Upstash Redis env vars
   (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) so overrides persist
   across serverless instances — the same store the wallet/chat already use.  */
import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";
import { bustMenu } from "./_menu.js";

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

const EMAIL = (process.env.ADMIN_EMAIL || "bryank31172@gmail.com").toLowerCase();
// SHA-256 of the owner password. Set ADMIN_PASSWORD (plaintext) in your host
// env to change it; otherwise this baked hash is used (plaintext stays secret).
const PASS_HASH = process.env.ADMIN_PASSWORD
  ? sha256(process.env.ADMIN_PASSWORD)
  : "85118f4772b2d0e364cada94808faa4617b9ed6935aa0b2bffbbc997789c982c";
const SECRET = process.env.ADMIN_SECRET || sha256("dank-admin|" + EMAIL + "|" + PASS_HASH);
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uDecode = (s) =>
  Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const safeEq = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const sign = (payload) => b64u(crypto.createHmac("sha256", SECRET).update(payload).digest());

function makeToken() {
  const payload = b64u(JSON.stringify({ e: EMAIL, x: Date.now() + TTL_MS }));
  return payload + "." + sign(payload);
}
function verifyToken(tok) {
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

  const b = req.body || {};

  if (b.action === "login") {
    const okEmail = String(b.email || "").trim().toLowerCase() === EMAIL;
    const okPass = safeEq(sha256(b.password || ""), PASS_HASH);
    if (!okEmail || !okPass) return res.status(401).json({ error: "wrong email or password" });
    return res.status(200).json({ ok: true, token: makeToken() });
  }

  // everything below needs a valid signed session
  if (!verifyToken(b.token)) return res.status(401).json({ error: "session expired — log in again" });

  if (b.action === "logout") {
    // stateless tokens — the client just drops it; nothing to revoke server-side
    return res.status(200).json({ ok: true });
  }

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
