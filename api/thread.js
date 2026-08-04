/* /api/thread — live customer ↔ staff chat threads.

   Customer (no auth; threadId is an unguessable token):
     POST {action:"start", customer:{name,contact}, transcript, cart, subtotal}
        → {threadId}
     POST {action:"send", threadId, text}            (from customer)
     GET  ?threadId=...&since=N                      → {status, messages:[...]}

   Staff (requires key = STAFF_KEY env; unset ⇒ the staff side is closed):
     GET  ?list=1&key=...                            → {threads:[summary]}
     GET  ?threadId=...&since=N&key=...              (same as customer)
     POST {action:"send", threadId, text, key, staffName}
     POST {action:"close", threadId, key}                                   */

import { getJSON, setJSON, indexAdd, indexList, usingRedis } from "./_store.js";
import { requireStaff, isStaffKey } from "./_auth.js";

const rid = () =>
  "CH" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      const { threadId, since, list, key } = req.query || {};
      if (list) {
        if (!requireStaff(req, res)) return;
        const ids = await indexList();
        const threads = [];
        for (const id of ids.slice(0, 60)) {
          const t = await getJSON("thread:" + id);
          if (!t) continue;
          const last = t.messages[t.messages.length - 1];
          threads.push({
            id: t.id, status: t.status, customer: t.customer,
            subtotal: t.subtotal, cartCount: (t.cart || []).length,
            createdAt: t.createdAt, lastAt: last?.at, lastText: last?.text?.slice(0, 80),
            lastFrom: last?.from, count: t.messages.length,
          });
        }
        return res.status(200).json({ threads, redis: usingRedis() });
      }
      if (!threadId) return res.status(400).json({ error: "threadId required" });
      const t = await getJSON("thread:" + threadId);
      if (!t) return res.status(404).json({ error: "not found" });
      const n = Number(since || 0);
      // The customer polls this too, with no key — they get the messages only.
      const staff = isStaffKey(key);
      return res.status(200).json({
        status: t.status,
        customer: staff ? t.customer : undefined,
        transcript: staff ? t.transcript : undefined,
        cart: staff ? t.cart : undefined,
        subtotal: staff ? t.subtotal : undefined,
        messages: t.messages.filter((m) => m.seq > n),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "method" });
    const b = req.body || {};

    if (b.action === "start") {
      const id = rid();
      const t = {
        id, status: "open",
        customer: { name: b.customer?.name || "", contact: b.customer?.contact || "" },
        transcript: (b.transcript || []).slice(-14),
        cart: b.cart || [], subtotal: b.subtotal || 0,
        createdAt: Date.now(),
        messages: [
          { seq: 1, from: "system", text: "Chat transferred to staff — customer is waiting.", at: Date.now() },
        ],
      };
      await setJSON("thread:" + id, t);
      await indexAdd(id);
      return res.status(200).json({ threadId: id });
    }

    if (b.action === "send") {
      const t = await getJSON("thread:" + b.threadId);
      if (!t) return res.status(404).json({ error: "not found" });
      const isStaff = isStaffKey(b.key);
      if (!isStaff && b.key) return res.status(401).json({ error: "bad key" });
      const text = String(b.text || "").slice(0, 1000).trim();
      if (!text) return res.status(400).json({ error: "empty" });
      const seq = (t.messages[t.messages.length - 1]?.seq || 0) + 1;
      t.messages.push({
        seq, from: isStaff ? "staff" : "customer",
        name: isStaff ? b.staffName || "Staff" : undefined,
        text, at: Date.now(),
      });
      if (t.messages.length > 300) t.messages = t.messages.slice(-300);
      if (isStaff) t.status = "open";
      await setJSON("thread:" + b.threadId, t);
      return res.status(200).json({ ok: true, seq });
    }

    if (b.action === "close") {
      if (!requireStaff(req, res)) return;
      const t = await getJSON("thread:" + b.threadId);
      if (!t) return res.status(404).json({ error: "not found" });
      t.status = "closed";
      t.messages.push({
        seq: (t.messages[t.messages.length - 1]?.seq || 0) + 1,
        from: "system", text: "Conversation closed by staff.", at: Date.now(),
      });
      await setJSON("thread:" + b.threadId, t);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("thread error:", e.message);
    return res.status(500).json({ error: "server" });
  }
}
