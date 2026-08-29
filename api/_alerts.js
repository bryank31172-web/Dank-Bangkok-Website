import webpush from "web-push";
import { getJSON, setJSON, indexAdd, indexList } from "./_store.js";
import { notifyStaffLine } from "./_line.js";
import { notifyStaffWhatsApp } from "./_whatsapp.js";

const ALERT_TTL = 60 * 60 * 24 * 30;
const SUB_TTL = 60 * 60 * 24 * 180;
const VAPID_PUBLIC = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || "mailto:dankclubbkk@gmail.com").trim();

export function pushConfigured() {
  return Boolean(VAPID_PUBLIC && VAPID_PRIVATE);
}

function configurePush() {
  if (!pushConfigured()) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  return true;
}

export function vapidPublicKey() {
  return VAPID_PUBLIC;
}

const alertKey = (id) => "order-alert:" + id;

export async function createOrderAlert(order) {
  const now = Date.now();
  const rec = {
    orderId: order.orderId,
    status: "pending",
    createdAt: now,
    acceptedAt: null,
    acceptedBy: "",
    escalationStage: 0,
    lastPushAt: 0,
    channels: {},
    order: {
      items: (order.items || []).map((item) => ({
        name: String(item.name || ""),
        option: String(item.option || ""),
        qty: Number(item.qty || 0),
        price: Number(item.price ?? item.unitPrice ?? 0),
        lineTotal: Number(item.lineTotal || 0),
      })),
      total: Number(order.total ?? order.subtotal ?? 0),
      customerName: String(order.customer?.name || "Customer"),
      fulfilment: String(order.fulfilment || ""),
      table: String(order.table || ""),
      branch: String(order.pickup?.branch || ""),
    },
  };
  await setJSON(alertKey(order.orderId), rec, ALERT_TTL);
  await indexAdd(order.orderId, "order-alerts:index");
  return rec;
}

export async function getOrderAlert(orderId) {
  return getJSON(alertKey(orderId));
}

export async function recordAlertChannel(orderId, channel, ok, detail = "") {
  const rec = await getOrderAlert(orderId);
  if (!rec) return;
  rec.channels = rec.channels || {};
  rec.channels[channel] = {
    ok: Boolean(ok),
    at: Date.now(),
    detail: String(detail || "").slice(0, 240),
  };
  await setJSON(alertKey(orderId), rec, ALERT_TTL);
}

export async function acceptOrderAlert(orderId, acceptedBy) {
  const rec = await getOrderAlert(orderId);
  if (!rec) return null;
  if (rec.status !== "accepted") {
    rec.status = "accepted";
    rec.acceptedAt = Date.now();
    rec.acceptedBy = String(acceptedBy || "Staff device").trim().slice(0, 80);
    await setJSON(alertKey(orderId), rec, ALERT_TTL);
    await sendPushPayload({
      type: "accepted",
      orderId,
      title: "Order accepted",
      body: `${orderId} accepted by ${rec.acceptedBy}`,
      tag: "dank-order-" + orderId,
    });
  }
  return rec;
}

export async function listOrderAlerts(limit = 100) {
  const ids = await indexList("order-alerts:index", { includeArchive: true });
  const out = [];
  for (const id of ids.slice(0, Math.min(Math.max(limit, 1), 300))) {
    const rec = await getOrderAlert(id);
    if (rec) out.push(rec);
  }
  return out;
}

async function subscriptions() {
  return (await getJSON("push:staff-subscriptions")) || [];
}

export async function saveSubscription(subscription, label = "") {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error("invalid subscription");
  }
  const all = await subscriptions();
  const next = all.filter((item) => item.endpoint !== subscription.endpoint);
  next.push({
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime || null,
    keys: subscription.keys,
    label: String(label || "Staff device").trim().slice(0, 80),
    updatedAt: Date.now(),
  });
  await setJSON("push:staff-subscriptions", next.slice(-100), SUB_TTL);
  return next.length;
}

export async function removeSubscription(endpoint) {
  const all = await subscriptions();
  const next = all.filter((item) => item.endpoint !== endpoint);
  await setJSON("push:staff-subscriptions", next, SUB_TTL);
  return next.length;
}

export async function pushSubscriptionHealth() {
  const all = await subscriptions();
  return {
    configured: pushConfigured(),
    subscribers: all.length,
    devices: all.map((s) => ({ label: s.label, updatedAt: s.updatedAt })),
  };
}

async function sendPushPayload(payload) {
  if (!configurePush()) return { ok: false, skipped: true, sent: 0, failed: 0 };
  const all = await subscriptions();
  let sent = 0, failed = 0;
  const stale = new Set();
  await Promise.all(all.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 90, urgency: "high" });
      sent += 1;
    } catch (error) {
      failed += 1;
      if (error?.statusCode === 404 || error?.statusCode === 410) stale.add(sub.endpoint);
    }
  }));
  if (stale.size) {
    await setJSON("push:staff-subscriptions", all.filter((s) => !stale.has(s.endpoint)), SUB_TTL);
  }
  return { ok: sent > 0, skipped: all.length === 0, sent, failed };
}

export async function sendOrderPush(alert, reason = "new") {
  const order = alert.order || {};
  const first = order.items?.[0];
  const more = Math.max(0, (order.items?.length || 0) - 1);
  const product = first
    ? `${first.name}${first.qty > 1 ? " ×" + first.qty : ""}${more ? " +" + more + " more" : ""}`
    : "New order";
  const result = await sendPushPayload({
    type: "order",
    reason,
    orderId: alert.orderId,
    title: reason === "escalation" ? "URGENT · Unaccepted order" : "DANK BKK · New order",
    body: `${product} · ฿${order.total || 0} · ${order.customerName || "Customer"}`,
    tag: "dank-order-" + alert.orderId,
    url: "/staff.html#orders",
    requireInteraction: true,
  });
  alert.lastPushAt = Date.now();
  await setJSON(alertKey(alert.orderId), alert, ALERT_TTL);
  await recordAlertChannel(alert.orderId, "webPush", result.ok, `sent=${result.sent}, failed=${result.failed}`);
  return result;
}

async function sendTelegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return { skipped: true, ok: false };
  try {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
    });
    const body = await response.json().catch(() => ({}));
    return { skipped: false, ok: response.ok && body.ok !== false, detail: body.description || "" };
  } catch (error) {
    return { skipped: false, ok: false, detail: error.message };
  }
}

async function sendEmail(alert, text) {
  if (!process.env.RESEND_API_KEY) return { skipped: true, ok: false };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ORDER_EMAIL_FROM || "orders@dankbkk.com",
        to: [process.env.ORDER_EMAIL_TO || "dankclubbkk@gmail.com"],
        subject: `URGENT: unaccepted order ${alert.orderId}`,
        text,
      }),
    });
    return { skipped: false, ok: response.ok, detail: response.ok ? "" : "HTTP " + response.status };
  } catch (error) {
    return { skipped: false, ok: false, detail: error.message };
  }
}

async function escalate(alert, stage) {
  const ageMin = Math.max(1, Math.floor((Date.now() - alert.createdAt) / 60000));
  const text = `🚨 UNACCEPTED ORDER ${alert.orderId} · waiting ${ageMin} min · ฿${alert.order?.total || 0}\nOpen: https://dankbangkok.com/staff.html#orders`;
  const attempts = [
    ["telegram", await sendTelegram(text)],
    ["line", await notifyStaffLine(text).catch((e) => ({ skipped: false, ok: false, detail: e.message }))],
    ["whatsapp", await notifyStaffWhatsApp(text).catch((e) => ({ skipped: false, ok: false, detail: e.message }))],
    ["email", await sendEmail(alert, text)],
  ];
  for (const [name, result] of attempts) {
    if (!result.skipped) await recordAlertChannel(alert.orderId, name + "Escalation" + stage, result.ok, result.detail || "");
  }
  alert.escalationStage = stage;
  await setJSON(alertKey(alert.orderId), alert, ALERT_TTL);
}

export async function sweepPendingAlerts() {
  const alerts = await listOrderAlerts(100);
  const now = Date.now();
  const report = { checked: alerts.length, pending: 0, pushed: 0, escalated: 0 };
  for (const alert of alerts) {
    if (alert.status !== "pending") continue;
    report.pending += 1;
    const age = now - alert.createdAt;
    if (!alert.lastPushAt || now - alert.lastPushAt >= 25_000) {
      const result = await sendOrderPush(alert, age >= 120_000 ? "escalation" : "repeat");
      if (result.ok) report.pushed += 1;
    }
    if (age >= 300_000 && alert.escalationStage < 2) {
      await escalate(alert, 2); report.escalated += 1;
    } else if (age >= 120_000 && alert.escalationStage < 1) {
      await escalate(alert, 1); report.escalated += 1;
    }
  }
  return report;
}

export function configuredChannels() {
  return {
    webPush: pushConfigured(),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    line: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && (process.env.LINE_TO || process.env.LINE_USER_ID || process.env.LINE_GROUP_ID)),
    whatsapp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TO),
    email: Boolean(process.env.RESEND_API_KEY),
  };
}
