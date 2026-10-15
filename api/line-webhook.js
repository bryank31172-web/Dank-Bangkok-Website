/* POST /api/line-webhook — verified LINE dispatch, delivery ETA and staff handoff.
   No external AI replies, group message logging or summaries.
   Env: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, LINE_TO. */
import { lineReply, notifyStaffLine, getLineProfile, verifyLineSignature } from "./_line.js";
import { computeEta, etaText, routeConfigured } from "./_route.js";
import {createDeliveryLineHandler} from "./_delivery-line.js";
const deliveryLine = createDeliveryLineHandler();

export const config = { api: { bodyParser: false } }; // we need the raw body for the signature

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Preserve the raw body so the LINE signature can be verified exactly.
  const raw = await readRaw(req);
  let body = {};
  if (raw) { try { body = JSON.parse(raw); } catch { return res.status(200).end(); } }
  else if (req.body) { body = req.body; }
  const sigOk = raw ? verifyLineSignature(raw, req.headers["x-line-signature"]) : false;
  if (!sigOk) return res.status(401).end();

  // Dispatch must finish before responding: Vercel may suspend work after send.
  const handledDeliveryEvents = new Set();
  for (const ev of body.events || []) {
    if (await deliveryLine(ev)) handledDeliveryEvents.add(ev);
  }

  // Finish retained customer support before acknowledging the webhook.

  for (const ev of body.events || []) {
    try {
      if (handledDeliveryEvents.has(ev)) continue;
      if (ev.type !== "message") continue;
      const src = ev.source || {};
      const sourceType = src.type; // 'user' | 'group' | 'room'
      const sourceId = src.groupId || src.roomId || src.userId;
      if (!sourceId) continue;

      const uid = src.userId || null;
      let displayName = null;
      if (uid) { const prof = await getLineProfile(uid); displayName = prof?.displayName || null; }

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

      // Non-dispatch group messages need no automated response.
      if (sourceType === "group" || sourceType === "room") continue;

      // 3b) Delivery-time question → ask them to share their location pin
      if (ETA_RE.test(text) && routeConfigured()) {
        await lineReply(ev.replyToken, "อยากทราบเวลาจัดส่งใช่ไหมคะ 🛵\nกดปุ่ม ➕ (มุมล่างซ้าย) → เลือก \"Location / ตำแหน่ง\" แล้วส่งพิกัดที่จัดส่งมาได้เลยค่ะ หนูจะคำนวณเวลาให้ทันที 🌿\n(Tap ➕ → Location to share your address and I'll estimate the delivery time.)");
        continue;
      }

      // Private customer chats retain staff handoff and a fixed menu reply.
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

      await lineReply(
        ev.replyToken,
        "สวัสดีค่ะ 🌿 หนูน้องแดงค์เองค่ะ! ดูเมนูและสั่งได้ที่ www.dankbangkok.com หรือพิมพ์ \"ติดต่อคน\" เพื่อคุยกับทีมงานค่ะ\n(Browse & order at www.dankbangkok.com, or type \"staff\" to reach our team.)"
      );
    } catch (e) { console.error("LINE event error:", e.message); }
  }
  return res.status(200).json({ ok: true });
}
