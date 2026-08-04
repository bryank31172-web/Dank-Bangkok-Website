/* Shared LINE Messaging API helper for the DANK website.
   Used for (1) staff alerts pushed to LINE and (2) the LINE Official Account
   AI channel (api/line-webhook.js).

   Env:
     LINE_CHANNEL_ACCESS_TOKEN  — Messaging API channel access token
     LINE_CHANNEL_SECRET        — channel secret (verifies incoming webhooks)
     LINE_TO                    — where staff alerts go: Bryan's userId OR a
                                  staff group id (the OA must be in that group)
*/
import crypto from "node:crypto";

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const SECRET = process.env.LINE_CHANNEL_SECRET || "";
const STAFF_TO = process.env.LINE_TO || "";

export const lineConfigured = () => Boolean(TOKEN);
export const lineStaffConfigured = () => Boolean(TOKEN && STAFF_TO);

// LINE caps a single text at 5000 chars and 5 messages per request.
const chunk = (text) => (String(text).match(/[\s\S]{1,4900}/g) || [""]).slice(0, 5);

export async function linePush(to, text) {
  if (!TOKEN) return { ok: false, error: "no LINE token" };
  const target = to || STAFF_TO;
  if (!target) return { ok: false, error: "no target" };
  try {
    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ to: target, messages: chunk(text).map((t) => ({ type: "text", text: t })) }),
    });
    if (!r.ok) return { ok: false, error: `${r.status} ${await r.text()}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function lineReply(replyToken, text) {
  if (!TOKEN || !replyToken) return { ok: false };
  try {
    const r = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ replyToken, messages: chunk(text).map((t) => ({ type: "text", text: t })) }),
    });
    return { ok: r.ok };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** Fire-and-forget staff alert to LINE_TO. No-op if LINE isn't configured. */
export async function notifyStaffLine(text) {
  if (!lineStaffConfigured()) return { ok: false, skipped: true };
  return linePush(STAFF_TO, text);
}

export async function getLineProfile(userId) {
  if (!TOKEN || !userId) return null;
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/* Verify an incoming LINE webhook signature against the raw request body.

   This returned TRUE when LINE_CHANNEL_SECRET was unset — "no secret, skip the
   check" — which meant a deployment that hadn't set the variable accepted any
   forged webhook body as genuinely from LINE. An unverifiable message is not a
   verified one: with no secret there is nothing to check against, so the answer
   is no. The webhook route falls back to its ?k=STAFF_KEY gate and 401s when
   neither passes. */
export function verifyLineSignature(rawBody, signature) {
  if (!SECRET || !signature) return false;
  try {
    const h = crypto.createHmac("sha256", SECRET).update(rawBody).digest("base64");
    return h === signature;
  } catch { return false; }
}
