/* LINE group message log + summarizer — the "Bryan AI monitor", folded into
   the website deployment. Instead of SQLite it uses the shared store (Upstash
   when configured); instead of node-cron it's driven by Vercel Cron hitting
   /api/line-summary. Logging happens inside /api/line-webhook.                */
import { getJSON, setJSON, indexAdd, indexList } from "./_store.js";

const KEEP = 1000;              // max messages kept per source
const MAX_AGE = 7 * 24 * 3600 * 1000; // prune anything older than 7 days
const IDX = "linelog:index";

export function monitoredIds() {
  return (process.env.MONITORED_GROUP_IDS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}
/** Is this source one we should log? (all, unless MONITORED_GROUP_IDS restricts groups) */
export function isMonitored(sourceType, sourceId) {
  const m = monitoredIds();
  if (!m.length) return true;
  if (sourceType === "group" || sourceType === "room") return m.includes(sourceId);
  return true; // 1:1 user chats always allowed
}

export async function logMessage({ sourceType, sourceId, userId, displayName, type, text, at }) {
  if (!sourceId) return;
  const key = "linelog:" + sourceId;
  const now = at || Date.now();
  const list = (await getJSON(key)) || [];
  list.push({ userId, displayName, type, text: text || null, at: now });
  const pruned = list.filter((m) => now - m.at < MAX_AGE).slice(-KEEP);
  await setJSON(key, pruned, 60 * 60 * 24 * 8);
  await indexAdd(sourceId, IDX);
}

export async function getMessagesSince(sourceId, sinceMs) {
  const list = (await getJSON("linelog:" + sourceId)) || [];
  return list.filter((m) => m.at >= sinceMs);
}

export async function listSources() {
  const m = monitoredIds();
  return m.length ? m : await indexList(IDX);
}

/** Summarize a batch of logged messages. Uses Grok when XAI_API_KEY is set,
    else returns a simple activity digest so it still works without AI. */
export async function summarize(messages, { sourceLabel = "กลุ่มนี้" } = {}) {
  const texts = (messages || []).filter((m) => m.type === "text" && m.text);
  if (!texts.length) return `ไม่มีข้อความใหม่ใน${sourceLabel}ในช่วงเวลานี้ค่ะ`;

  if (!process.env.XAI_API_KEY) {
    const people = new Set(texts.map((m) => m.displayName || m.userId)).size;
    const preview = texts.slice(-8).map((m) => `• ${m.displayName || "?"}: ${m.text}`).join("\n");
    return `สรุปแบบย่อ (ยังไม่ได้ตั้งค่า AI):\n${texts.length} ข้อความ จาก ${people} คน\n\nล่าสุด:\n${preview}`;
  }

  const transcript = texts.slice(-400)
    .map((m) => `${m.displayName || "ไม่ทราบชื่อ"}: ${m.text}`).join("\n").slice(0, 12000);
  const system = `คุณคือผู้ช่วยสรุปแชทกลุ่ม LINE ของธุรกิจ DANK. สรุปบทสนทนาต่อไปนี้ให้เป็นภาษาไทย กระชับ เป็นหัวข้อ (bullet) เน้นสิ่งที่ต้องทำ/ตัดสินใจ, ปัญหา, และคำถามที่ยังไม่ได้ตอบ. อย่าแต่งเรื่องเพิ่ม.`;
  try {
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.GROK_MODEL || "grok-4",
        messages: [{ role: "system", content: system }, { role: "user", content: transcript }],
        max_tokens: 700, temperature: 0.4,
      }),
    });
    if (!r.ok) throw new Error("xAI " + r.status);
    const j = await r.json();
    return j.choices?.[0]?.message?.content?.trim() || "สรุปไม่สำเร็จ ลองใหม่อีกครั้งค่ะ";
  } catch (e) {
    console.error("LINE summarize fail:", e.message);
    return "ขอโทษค่ะ สรุปไม่สำเร็จ ลองใหม่อีกครั้ง";
  }
}
