import { requireStaff } from "./_auth.js";
import { acceptOrderAlert } from "./_alerts.js";
import { getJSON, setJSON } from "./_store.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!requireStaff(req, res)) return;
  const orderId = String(req.body?.orderId || "").trim();
  if (!orderId) return res.status(400).json({ error: "orderId required" });
  const alert = await acceptOrderAlert(orderId, req.body?.acceptedBy);
  if (!alert) return res.status(404).json({ error: "alert not found" });
  const order = await getJSON("order:" + orderId);
  if (order) {
    order.alertAcceptedAt = alert.acceptedAt;
    order.alertAcceptedBy = alert.acceptedBy;
    await setJSON("order:" + orderId, order);
  }
  return res.status(200).json({ ok: true, alert });
}
