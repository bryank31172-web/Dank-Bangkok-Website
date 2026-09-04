import { getJSON, setJSON } from "./_store.js";
import { SEARCH_POPULAR_KEY, SEARCH_TTL, cleanSearch, normalSearch, popularRows, safeAggregateQuery } from "./_search-data.js";

const buckets = new Map();
function limited(req) {
  const ip = cleanSearch(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown", 100).split(",")[0];
  const now = Date.now(), item = buckets.get(ip);
  if (!item || now - item.at > 60000) { buckets.set(ip, { at: now, count: 1 }); return false; }
  item.count += 1; return item.count > 40;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (limited(req)) return res.status(429).json({ error: "too many events" });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const event = cleanSearch(body.event, 20);
  const query = safeAggregateQuery(body.query);
  if (!query || !["search", "result_click", "suggestion_click"].includes(event)) return res.status(202).json({ ok: true });
  if (event !== "search") return res.status(202).json({ ok: true });
  try {
    const rows = popularRows(await getJSON(SEARCH_POPULAR_KEY));
    const key = normalSearch(query), found = rows.find(row => normalSearch(row.query) === key);
    if (found) { found.count += 1; found.at = Date.now(); }
    else rows.push({ query, count: 1, at: Date.now() });
    await setJSON(SEARCH_POPULAR_KEY, popularRows(rows), SEARCH_TTL);
  } catch (_) { /* Search must never fail because analytics storage is unavailable. */ }
  return res.status(202).json({ ok: true });
}
