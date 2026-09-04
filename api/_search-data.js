export const CURATED_SEARCHES = [
  { label: "Relaxing flower", query: "relaxing flower", icon: "spa" },
  { label: "Pre-rolls", query: "pre-rolls", icon: "local_fire_department" },
  { label: "CBD wellness", query: "CBD wellness", icon: "health_and_safety" },
  { label: "Food & drinks", query: "food drinks", icon: "restaurant" },
  { label: "Budget picks", query: "budget flower", icon: "sell" },
];

export const SEARCH_POPULAR_KEY = "search:popular:v1";
export const SEARCH_TTL = 60 * 60 * 24 * 180;

export function cleanSearch(value, max = 120) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalSearch(value) {
  return cleanSearch(value, 500).normalize("NFKD").toLowerCase()
    .replace(/[^\p{Letter}\p{Number}.&-]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function safeAggregateQuery(value) {
  const query = cleanSearch(value);
  if (query.length < 2 || query.length > 80) return "";
  if (/https?:|www\.|@|\b\d{7,}\b/i.test(query)) return "";
  if (/password|passcode|staff\s*key|secret|token|api\s*key/i.test(query)) return "";
  return query;
}

export function popularRows(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.filter(row => row && safeAggregateQuery(row.query))
    .map(row => ({ query: cleanSearch(row.query, 80), count: Math.max(1, Number(row.count) || 1), at: Number(row.at) || 0 }))
    .sort((a, b) => b.count - a.count || b.at - a.at).slice(0, 30);
}
