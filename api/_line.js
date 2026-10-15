/* Shared LINE Messaging API helper for the DANK website.
   Used for (1) staff alerts pushed to LINE and (2) the LINE Official Account
   dispatch and support channel (api/line-webhook.js).

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

// Structured messages support delivery buttons without changing existing alerts.
export async function lineMessages(target, messages, {reply = false, retryKey} = {}) {
  if (!TOKEN || !target) return {ok: false, skipped: true};
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/' + (reply ? 'reply' : 'push'), {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`,
        ...(!reply && retryKey ? {'X-Line-Retry-Key': retryKey} : {})},
      body: JSON.stringify({[reply ? 'replyToken' : 'to']: target, messages}),
    });
    return {ok: r.ok || (!reply && Boolean(retryKey) && r.status === 409)};
  } catch { return {ok: false}; }
}

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

/* Is this LINE user a member of the staff group (LINE_TO)? Uses the Messaging API
   "group member profile" lookup: 200 means a member, 404 means not. Results are
   cached for 10 minutes so the form doesn't ask LINE on every request. */
const memberCache = new Map();
export async function isStaffGroupMember(userId) {
  if (!TOKEN || !/^C[0-9a-f]{32}$/.test(STAFF_TO) || !/^U[0-9a-f]{32}$/.test(userId || "")) return false;
  const hit = memberCache.get(userId);
  if (hit && hit.until > Date.now()) return hit.member;
  try {
    const r = await fetch(`https://api.line.me/v2/bot/group/${STAFF_TO}/member/${userId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(5000) });
    if (r.status !== 200 && r.status !== 404) return false; // don't cache LINE outages
    const member = r.status === 200;
    if (memberCache.size > 500) memberCache.clear();
    memberCache.set(userId, { member, until: Date.now() + 10 * 60000 });
    return member;
  } catch { return false; }
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
