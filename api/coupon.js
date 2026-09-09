/* Capture consented coupon leads and deliver a one-use FREEJOINT coupon.
   Customer data stays server-side in the existing site store. */
import crypto from "node:crypto";
import { getJSON, setJSON } from "./_store.js";
import { requirePermission } from "./_auth.js";
import { requireRate } from "./_ratelimit.js";
import { normPhone } from "./_phone.js";

const LEADS_KEY = "marketing:coupon-leads";
const ttl = 60 * 60 * 24 * 3650;
const cleanEmail = (v) => String(v || "").trim().toLowerCase();
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const codeFor = () => "JOINT-" + crypto.randomBytes(4).toString("hex").toUpperCase();

async function sendEmail(email, name, code) {
  if (!email || !process.env.RESEND_API_KEY) return { configured: false, sent: false };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.COUPON_EMAIL_FROM || process.env.ORDER_EMAIL_FROM || "offers@dankbangkok.com",
      to: [email],
      subject: "Your free joint coupon from DANK",
      html: `<h2>Your DANK coupon is ready 🌿</h2><p>Hi ${escapeHtml(name || "there")},</p><p>Use code <b>${code}</b> with your next purchase to receive one free pre-rolled joint.</p><p>One use per customer. Adults 20+ only. ID required. Subject to stock availability.</p><p><a href="https://www.dankbangkok.com/#menu">Shop DANK</a></p>`,
    }),
  });
  return { configured: true, sent: response.ok };
}

async function sendSms(phone, code) {
  const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = String(process.env.TWILIO_FROM_NUMBER || "").trim();
  if (!phone || !sid || !token || !from) return { configured: false, sent: false };
  const to = phone.startsWith("0") ? "+66" + phone.slice(1) : "+" + phone.replace(/^\+/, "");
  const body = new URLSearchParams({
    To: to, From: from,
    Body: `DANK coupon ${code}: free pre-rolled joint with your next purchase. One use, 20+ ID required. Stop: reply STOP.`,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return { configured: true, sent: response.ok };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    if (!requirePermission(req, res, "owner_tools")) return;
    const leads = (await getJSON(LEADS_KEY)) || [];
    return res.status(200).json({ ok: true, count: leads.length, leads: leads.slice(0, 5000) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await requireRate(req, res, "coupon", 8, 3600))) return;

  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 80);
  const email = cleanEmail(b.email);
  const phone = normPhone(b.phone);
  if (b.consent !== true) return res.status(400).json({ error: "marketing consent required" });
  if (!validEmail(email) && phone.length < 9) return res.status(400).json({ error: "valid email or phone required" });

  const leads = (await getJSON(LEADS_KEY)) || [];
  let lead = leads.find((x) => (email && x.email === email) || (phone && x.phone === phone));
  let code = lead && lead.code;
  if (!code) {
    code = codeFor();
    lead = { name, email: validEmail(email) ? email : "", phone: phone.length >= 9 ? phone : "", code, consent: true, consentAt: Date.now(), source: "homepage-coupon", status: "active" };
    leads.unshift(lead);
    await setJSON(LEADS_KEY, leads.slice(0, 5000), ttl);
    await setJSON("coupon:" + code, { active: true, type: "gift", gift: "1 free pre-rolled joint", desc: "Free joint coupon", quantity: 1, min: 0 }, ttl);
    const hook = String(process.env.CRM_WEBHOOK_URL || "").trim();
    if (hook) fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...lead, at: Date.now(), marketingConsent: true }) }).catch(() => {});
  }

  const [emailResult, smsResult] = await Promise.all([
    sendEmail(lead.email, lead.name, code).catch(() => ({ configured: true, sent: false })),
    sendSms(lead.phone, code).catch(() => ({ configured: true, sent: false })),
  ]);
  return res.status(200).json({ ok: true, code, reward: "1 free pre-rolled joint", email: emailResult, sms: smsResult });
}

function escapeHtml(value) {
  return String(value || "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}
