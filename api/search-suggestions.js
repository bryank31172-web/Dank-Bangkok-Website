import { getJSON } from "./_store.js";
import { CURATED_SEARCHES, SEARCH_POPULAR_KEY, popularRows } from "./_search-data.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  const stored = await getJSON(SEARCH_POPULAR_KEY).catch(() => []);
  const popular = popularRows(stored).slice(0, 6).map(row => row.query);
  const defaults = ["flowers", "pre-rolls", "CBD products", "food & drinks"];
  return res.status(200).json({
    popularQueries: popular.length >= 3 ? popular : defaults,
    customSuggestions: CURATED_SEARCHES,
  });
}
