/* /api/count — shift-close cycle count with proof-of-existence photos.
     POST { staff, lines:[{code,name,expected,counted}], photos:[dataURL,…], note }
        → stores the count session + photos, pings staff (Telegram) with variances.
     GET  ?key=STAFF_KEY&list=1        → recent sessions (no images)
     GET  ?key=STAFF_KEY&id=<id>       → full session { …, photos:[dataURL] }
   Requires STAFF_KEY. Photos are resized client-side before upload.          */
import { getJSON, setJSON, indexAdd, indexList } from "./_store.js";
import { notifyStaffLine } from "./_line.js";

const STAFF_KEY = process.env.STAFF_KEY || "dankstaff";
const IDX = "counts:index";
const MAX_PHOTOS = 12;
const MAX_PHOTO_BYTES = 700000; // ~520KB each after client resize

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  // -------- GET (staff only) --------
  if (req.method === "GET") {
    if (req.query?.key !== STAFF_KEY) return res.status(401).json({ error: "bad key" });
    if (req.query.id) {
      const s = await getJSON("count:" + req.query.id);
      if (!s) return res.status(404).json({ error: "not found" });
      const photos = [];
      for (let i = 0; i < (s.photoCount || 0); i++) {
        const img = await getJSON(`countphoto:${req.query.id}:${i}`);
        if (img) photos.push(img);
      }
      return res.status(200).json({ ...s, photos });
    }
    // list recent
    const ids = await indexList(IDX);
    const rows = [];
    for (const id of ids.slice(0, 40)) {
      const s = await getJSON("count:" + id);
      if (s) rows.push(s);
    }
    return res.status(200).json({ sessions: rows });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  // -------- POST --------
  const b = req.body || {};
  const lines = Array.isArray(b.lines) ? b.lines : [];
  const photos = Array.isArray(b.photos) ? b.photos : [];
  if (!lines.length) return res.status(400).json({ error: "no count lines" });
  if (!photos.length) return res.status(400).json({ error: "at least one proof photo required" });
  if (photos.length > MAX_PHOTOS) return res.status(413).json({ error: `max ${MAX_PHOTOS} photos` });
  for (const ph of photos) {
    if (!/^data:image\//.test(ph) || ph.length > MAX_PHOTO_BYTES)
      return res.status(413).json({ error: "a photo is invalid or too large" });
  }

  const id = "CNT-" + Date.now().toString(36).toUpperCase();
  const norm = lines.map((l) => {
    const expected = Number(l.expected) || 0;
    const counted = l.counted === "" || l.counted == null ? null : Number(l.counted);
    return {
      code: String(l.code || ""),
      name: String(l.name || ""),
      expected,
      counted,
      variance: counted == null ? null : +(counted - expected).toFixed(2),
    };
  });
  const variances = norm.filter((l) => l.variance != null && l.variance !== 0);

  const session = {
    id,
    staff: String(b.staff || "staff"),
    note: String(b.note || ""),
    at: Date.now(),
    total: norm.length,
    countedItems: norm.filter((l) => l.counted != null).length,
    varianceCount: variances.length,
    photoCount: photos.length,
    lines: norm,
  };

  await setJSON("count:" + id, session, 60 * 60 * 24 * 120);
  for (let i = 0; i < photos.length; i++)
    await setJSON(`countphoto:${id}:${i}`, photos[i], 60 * 60 * 24 * 120);
  await indexAdd(id, IDX);

  // ping staff
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
      const varTxt = variances.length
        ? variances.slice(0, 12).map((v) => `• ${v.code} ${v.name}: ${v.variance > 0 ? "+" : ""}${v.variance}`).join("\n")
        : "No variances 🎉";
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `📦 Shift count closed by ${session.staff}\nSession ${id}\n${session.countedItems}/${session.total} items counted · ${photos.length} proof photo(s)\nVariances (${variances.length}):\n${varTxt}\nView: https://${host}/staff.html#count`,
        }),
      });
    } catch (e) {}
  }

  // LINE alert to staff (if configured)
  try {
    const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
    await notifyStaffLine(`📦 Shift count closed by ${session.staff}\n${session.countedItems}/${session.total} counted · ${photos.length} photo(s) · ${variances.length} variance(s)\nView: https://${host}/staff.html#count`);
  } catch (e) {}

  return res.status(200).json({ ok: true, id, varianceCount: variances.length });
}
