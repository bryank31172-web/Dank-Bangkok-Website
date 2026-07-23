/* /api/line-summary — daily LINE group summary (Bryan AI monitor), serverless.
   Driven by Vercel Cron (see vercel.json) once a day, and callable on demand.

     GET   (Vercel Cron, or ?key=STAFF_KEY)   → summarize last 24h of every
           monitored source, push each to LINE_TO. Auth: Vercel's cron
           Authorization: Bearer $CRON_SECRET, or ?key=STAFF_KEY.
     POST  { sourceId?, hours?, key }         → summarize one source (or all),
           push to LINE_TO, and return the text. Requires key = STAFF_KEY.

   Env: STAFF_KEY, LINE_CHANNEL_ACCESS_TOKEN, LINE_TO, XAI_API_KEY, CRON_SECRET
        (optional, set it so Vercel Cron authorizes itself), SUMMARY_TO
        (optional override of where summaries go; defaults to LINE_TO).        */
import { listSources, getMessagesSince, summarize } from "./_linelog.js";
import { linePush } from "./_line.js";

const STAFF_KEY = process.env.STAFF_KEY || "dankstaff";

function cronAuthed(req) {
  const cs = process.env.CRON_SECRET;
  if (cs && req.headers?.authorization === `Bearer ${cs}`) return true;
  return false;
}

async function runAll(hours) {
  const since = Date.now() - hours * 3600 * 1000;
  const to = process.env.SUMMARY_TO || process.env.LINE_TO;
  const ids = await listSources();
  const out = [];
  for (const id of ids) {
    const msgs = await getMessagesSince(id, since);
    const text = await summarize(msgs, { sourceLabel: id });
    if (to) await linePush(to, `📋 สรุปกลุ่ม ${id} (${hours} ชม.)\n\n${text}`);
    out.push({ sourceId: id, messages: msgs.length });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  // ---- GET: cron / quick manual ----
  if (req.method === "GET") {
    if (!cronAuthed(req) && req.query?.key !== STAFF_KEY)
      return res.status(401).json({ error: "unauthorized" });
    const hours = Number(req.query?.hours) || 24;
    try {
      const done = await runAll(hours);
      return res.status(200).json({ ok: true, summarized: done });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ---- POST: on-demand (staff) ----
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  const b = req.body || {};
  if (b.key !== STAFF_KEY) return res.status(401).json({ error: "bad key" });
  const hours = Number(b.hours) || 24;
  const to = process.env.SUMMARY_TO || process.env.LINE_TO;
  try {
    if (b.sourceId) {
      const since = Date.now() - hours * 3600 * 1000;
      const msgs = await getMessagesSince(b.sourceId, since);
      const summary = await summarize(msgs, { sourceLabel: b.sourceId });
      if (to) await linePush(to, `📋 สรุปกลุ่ม ${b.sourceId} (${hours} ชม.)\n\n${summary}`);
      return res.status(200).json({ ok: true, summary, messages: msgs.length });
    }
    const done = await runAll(hours);
    return res.status(200).json({ ok: true, summarized: done });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
