/* POST /api/line-webhook — your LINE Official Account, powered by the website.
   Does three jobs from one endpoint:
     1) 1:1 chats  → น้องแดงค์ AI budtender answers from your live menu + handoff.
     2) Groups     → logs every message (Bryan AI monitor) for the daily summary.
     3) "สรุป"      → typed in any chat/group, replies an instant Thai summary.

   Set this URL in LINE Developers Console → Messaging API → Webhook URL:
     https://www.dankbkk.com/api/line-webhook?k=YOUR_STAFF_KEY
   (the ?k= gate is an extra check on top of the LINE signature.)

   Env: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, LINE_TO (staff),
        XAI_API_KEY (+ GROK_MODEL), STAFF_KEY, MONITORED_GROUP_IDS (optional). */
import { lineReply, notifyStaffLine, getLineProfile, verifyLineSignature } from "./_line.js";
import { getJSON, setJSON } from "./_store.js";
import { getMenu } from "./_menu.js";
import { logMessage, isMonitored, getMessagesSince, summarize } from "./_linelog.js";
import { computeEta, etaText, routeConfigured } from "./_route.js";

export const config = { api: { bodyParser: false } }; // we need the raw body for the signature

const STAFF_KEY = process.env.STAFF_KEY || "dankstaff";
const HANDOFF_RE = /(staff|human|agent|admin|real person|talk to|แอดมิน|พนักงาน|คนจริง|ติดต่อ(เจ้าหน้าที่|คน)|คุยกับคน)/i;
// customer asking about delivery time → prompt them to drop a location pin
const ETA_RE = /(กี่โมง|กี่นาที|นานไหม|นานมั้ย|เวลาส่ง|ส่งกี่|ถึงกี่|delivery|eta|how long|arrive)/i;

function readRaw(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
    req.on("error", () => resolve(""));
  });
}

async function menuContext() {
  try {
    const m = await getMenu();
    const items = (m.data || []).slice(0, 40).map((p) => {
      const price = p.price ?? p.priceTiers?.[0]?.price;
      return `- ${p.name}${p.type ? " (" + p.type + ")" : ""}${p.thcLabel ? " THC " + p.thcLabel : ""}${price ? " · from ฿" + price : ""}`;
    });
    return `You are น้องแดงค์ (Nong Dank), the friendly AI budtender for DANK Cannabis Club, Bangkok.\nMENU (live):\n${items.join("\n")}`;
  } catch {
    return "You are น้องแดงค์ (Nong Dank), the friendly AI budtender for DANK Cannabis Club, Bangkok.";
  }
}

async function grokReply(userId, message) {
  if (!process.env.XAI_API_KEY) return "";
  const histKey = "linehist:" + userId;
  const history = (await getJSON(histKey)) || [];
  const context = await menuContext();
  const system = `${context}

Rules:
- Warm, concise (2-4 sentences), salesy-but-honest. Help them choose and order.
- Reply in the customer's language (Thai or English).
- Only recommend items from the MENU; quote real ฿ prices.
- No medical claims; 20+ only. To buy: send them to https://www.dankbkk.com or say staff will help.`;
  const messages = [
    { role: "system", content: system },
    ...history.slice(-8),
    { role: "user", content: String(message).slice(0, 1000) },
  ];
  try {
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.GROK_MODEL || "grok-4", messages, max_tokens: 300, temperature: 0.6 }),
    });
    if (!r.ok) throw new Error("xAI " + r.status);
    const j = await r.json();
    const reply = j.choices?.[0]?.message?.content?.trim() || "";
    if (reply) {
      history.push({ role: "user", content: String(message).slice(0, 500) });
      history.push({ role: "assistant", content: reply.slice(0, 500) });
      await setJSON(histKey, history.slice(-16), 60 * 60 * 24);
    }
    return reply;
  } catch (e) { console.error("LINE grok fail:", e.message); return ""; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Robust body + auth: on Vercel the raw stream may already be parsed, so accept
  // either a valid LINE signature (raw available) OR the ?k= gate on the URL.
  const raw = await readRaw(req);
  let body = {};
  if (raw) { try { body = JSON.parse(raw); } catch { return res.status(200).end(); } }
  else if (req.body) { body = req.body; }
  const sigOk = raw ? verifyLineSignature(raw, req.headers["x-line-signature"]) : false;
  const keyOk = req.query?.k && req.query.k === STAFF_KEY;
  if (!sigOk && !keyOk) return res.status(401).end();

  // Respond 200 fast, then process (LINE requires a quick ack)
  res.status(200).json({ ok: true });

  for (const ev of body.events || []) {
    try {
      if (ev.type !== "message") continue;
      const src = ev.source || {};
      const sourceType = src.type; // 'user' | 'group' | 'room'
      const sourceId = src.groupId || src.roomId || src.userId;
      if (!sourceId || !isMonitored(sourceType, sourceId)) continue;

      const uid = src.userId || null;
      let displayName = null;
      if (uid) { const prof = await getLineProfile(uid); displayName = prof?.displayName || null; }

      // 1) log every message (for the daily summary / monitor)
      await logMessage({
        sourceType, sourceId, userId: uid, displayName,
        type: ev.message.type,
        text: ev.message.type === "text" ? ev.message.text : null,
        at: ev.timestamp,
      });

      // 1b) LOCATION pin in a 1:1 chat → reply an estimated delivery time
      if (ev.message.type === "location" && sourceType === "user") {
        if (routeConfigured()) {
          const eta = await computeEta({ destLat: ev.message.latitude, destLng: ev.message.longitude, address: ev.message.address });
          await lineReply(ev.replyToken, etaText(eta));
          if (eta.ok) await notifyStaffLine(`🛵 ETA quoted to ${displayName || sourceId}: ~${eta.minutes} min${eta.km != null ? ` (${eta.km} km)` : ""}${eta.branch?.name ? ` from ${eta.branch.name}` : ""}\n📍 ${ev.message.address || `${ev.message.latitude},${ev.message.longitude}`}`);
        } else {
          await lineReply(ev.replyToken, "ขอบคุณสำหรับพิกัดค่ะ 📍 เดี๋ยวทีมงานคำนวณเวลาจัดส่งให้นะคะ 🌿");
        }
        continue;
      }

      if (ev.message.type !== "text") continue;
      const text = ev.message.text.trim();

      // 2) "สรุป" (optionally "สรุป 6") → instant summary, replied in that chat
      if (/^สรุป(\s+\d+)?$/.test(text)) {
        const hrs = text.match(/\d+/) ? parseInt(text.match(/\d+/)[0], 10) : 24;
        const msgs = await getMessagesSince(sourceId, Date.now() - hrs * 3600 * 1000);
        const summary = await summarize(msgs, { sourceLabel: sourceType === "group" ? "กลุ่มนี้" : "แชทนี้" });
        await lineReply(ev.replyToken, `📋 สรุปย้อนหลัง ${hrs} ชม.\n\n${summary}`);
        continue;
      }

      // 3) In groups/rooms we only monitor — don't AI-reply to every message.
      if (sourceType === "group" || sourceType === "room") continue;

      // 3b) Delivery-time question → ask them to share their location pin
      if (ETA_RE.test(text) && routeConfigured()) {
        await lineReply(ev.replyToken, "อยากทราบเวลาจัดส่งใช่ไหมคะ 🛵\nกดปุ่ม ➕ (มุมล่างซ้าย) → เลือก \"Location / ตำแหน่ง\" แล้วส่งพิกัดที่จัดส่งมาได้เลยค่ะ หนูจะคำนวณเวลาให้ทันที 🌿\n(Tap ➕ → Location to share your address and I'll estimate the delivery time.)");
        continue;
      }

      // 4) 1:1 chat = customer support. Handoff on request, else น้องแดงค์ AI.
      if (HANDOFF_RE.test(text)) {
        await lineReply(ev.replyToken, "รับทราบค่ะ 🙏 กำลังเรียกทีมงานให้มาช่วยดูแลนะคะ เดี๋ยวมีคนตอบเร็ว ๆ นี้ค่ะ\n(Connecting you to our team — someone will reply shortly.)");
        await notifyStaffLine(`🙋 LINE handoff — customer needs staff\nFrom: ${displayName || sourceId}\nThey said: "${text}"\nReply to them in your LINE OA chat.`);
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
          try {
            await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: `🙋 LINE handoff from ${displayName || sourceId}: "${text}"` }),
            });
          } catch {}
        }
        continue;
      }

      const reply = await grokReply(sourceId, text);
      await lineReply(
        ev.replyToken,
        reply ||
          "สวัสดีค่ะ 🌿 หนูน้องแดงค์เองค่ะ! ดูเมนูและสั่งได้ที่ www.dankbkk.com หรือพิมพ์ \"ติดต่อคน\" เพื่อคุยกับทีมงานค่ะ\n(Browse & order at www.dankbkk.com, or type \"staff\" to reach our team.)"
      );
    } catch (e) { console.error("LINE event error:", e.message); }
  }
}
