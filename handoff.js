/* POST /api/handoff — DANK AI transfers a chat to human staff.
   Sends the full transcript + cart + customer contact to staff, fast:

     1. TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID → instant push to your
        staff Telegram group (create a bot with @BotFather, add it to
        the group, use the group's chat id). Best channel: free,
        instant, phones buzz.
     2. RESEND_API_KEY → email to HANDOFF_EMAIL_TO / ORDER_EMAIL_TO
        (default dankclubbkk@gmail.com).
     3. HANDOFF_FORWARD_URL → optional POST into BRYAN POS (e.g. its
        Alerts/notifications intake) so it appears in the app too.

   Returns {ok, ticketId, delivered} — delivered=false means no channel
   is configured yet (logged in Vercel logs); the widget then sends the
   customer straight to LINE so nobody is left hanging.

   Each call pushes a LINE message (billable), a Telegram message and an
   email, from a request that carries no key — the shopper pressing "talk to
   a human" hasn't got one. So it is gated the same way /api/chat is: the
   request must come from a page on this deployment, and one address only gets
   a few per hour. Staff tooling can also pass the staff key and skip both. */

import { notifyStaffLine } from "./_line.js";
import { isStaff, sameOrigin } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";

const esc = (s) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!isStaff(req)) {
    if (!sameOrigin(req)) return res.status(403).json({ error: "forbidden" });
    // A customer asks for a human once, maybe twice if the first went quiet.
    if (!(await requireRate(req, res, "handoff", 5, 3600))) return;
  }

  const { transcript, customer, reason, cart, subtotal, threadId } = req.body || {};
  if (!customer?.contact) return res.status(400).json({ error: "contact required" });

  const ticketId = threadId || "CH" + Date.now().toString(36).toUpperCase();
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "dankbkk.com";
  const consoleLink = `https://${host}/staff.html${threadId ? "#" + threadId : ""}`;
  const when = new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
  const chatLines = (Array.isArray(transcript) ? transcript : [])
    .slice(-14)
    .map((m) => `${m.role === "user" ? "🧑 Customer" : "🤖 DANK AI"}: ${m.text}`)
    .join("\n");
  const cartLines = (Array.isArray(cart) ? cart : [])
    .map((c) => `• ${c.name} (${c.option}) ×${c.qty} — ฿${c.lineTotal}`)
    .join("\n");

  const plain =
    `🙋 CHAT HANDOFF ${ticketId} — dankbkk.com\n` +
    `Reason: ${reason || "customer asked for staff"}\n` +
    `Time: ${when} (Bangkok)\n` +
    `Customer: ${customer.name || "-"} · ${customer.contact}\n` +
    (cartLines ? `\n🛒 Cart (฿${subtotal ?? "-"}):\n${cartLines}\n` : "\n🛒 Cart: empty\n") +
    `\n💬 Conversation:\n${chatLines}\n\n` +
    (threadId
      ? `➡️ REPLY IN THE LIVE CHAT NOW: ${consoleLink}\n(backup: LINE/phone ${customer.contact})`
      : `➡️ Reply to the customer now via LINE/phone: ${customer.contact}`);

  const results = [];

  // 1) Telegram — instant staff ping
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: plain }),
      });
      results.push(r.ok);
    } catch (e) { results.push(false); }
  }

  // 2) Email
  if (process.env.RESEND_API_KEY) {
    try {
      const to = process.env.HANDOFF_EMAIL_TO || process.env.ORDER_EMAIL_TO || "dankclubbkk@gmail.com";
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.ORDER_EMAIL_FROM || "orders@dankbkk.com",
          to: [to],
          subject: `🙋 Chat handoff ${ticketId} — customer waiting (${customer.contact})`,
          html: `<pre style="font-family:inherit;white-space:pre-wrap">${esc(plain)}</pre>`,
        }),
      });
      results.push(r.ok);
    } catch (e) { results.push(false); }
  }

  // 2b) LINE push to staff (Bryan / staff group)
  try { const r = await notifyStaffLine(plain); if (!r.skipped) results.push(r.ok); } catch (e) {}

  // 3) Forward into BRYAN POS
  if (process.env.HANDOFF_FORWARD_URL) {
    try {
      const r = await fetch(process.env.HANDOFF_FORWARD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, reason, customer, cart, subtotal, transcript, at: when }),
      });
      results.push(r.ok);
    } catch (e) { results.push(false); }
  }

  if (results.length === 0) {
    console.log("HANDOFF (no channels configured):", plain);
    return res.status(200).json({ ok: true, ticketId, delivered: false });
  }
  if (results.some(Boolean)) return res.status(200).json({ ok: true, ticketId, delivered: true });
  return res.status(502).json({ error: "all handoff channels failed" });
}
