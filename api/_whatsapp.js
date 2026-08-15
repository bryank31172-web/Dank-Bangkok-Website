/* Shared WhatsApp Cloud API helper for staff order alerts.

   Env:
     WHATSAPP_ACCESS_TOKEN       — Meta system-user access token
     WHATSAPP_PHONE_NUMBER_ID    — sender phone-number id from WhatsApp Manager
     WHATSAPP_TO                 — staff numbers, international digits, comma-separated
     WHATSAPP_API_VERSION        — Graph API version (default v23.0)
     WHATSAPP_TEMPLATE_NAME      — optional approved utility template
     WHATSAPP_TEMPLATE_LANGUAGE  — template locale (default en_US)

   A template is the reliable choice for business-initiated alerts. Plain text
   is retained as a useful fallback, but Meta only accepts it while the
   recipient's 24-hour customer-service window is open. */

const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const TEMPLATE = process.env.WHATSAPP_TEMPLATE_NAME || "";
const LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US";

const version = () => {
  const raw = String(process.env.WHATSAPP_API_VERSION || "v23.0").trim();
  return /^v\d+\.\d+$/.test(raw) ? raw : "v23.0";
};

const recipients = () => String(process.env.WHATSAPP_TO || "")
  .split(/[,;\n]+/)
  .map((number) => number.replace(/\D/g, ""))
  .filter(Boolean);

export const whatsappConfigured = () => Boolean(TOKEN && PHONE_ID && recipients().length);

function payload(to, text) {
  const body = String(text || "").trim();
  if (TEMPLATE) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: TEMPLATE,
        language: { code: LANGUAGE },
        components: [{
          type: "body",
          parameters: [{ type: "text", text: body.slice(0, 1024) }],
        }],
      },
    };
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { preview_url: false, body: body.slice(0, 4096) },
  };
}

export async function notifyStaffWhatsApp(text) {
  const to = recipients();
  if (!TOKEN || !PHONE_ID || !to.length) return { ok: false, skipped: true };

  const endpoint = `https://graph.facebook.com/${version()}/${encodeURIComponent(PHONE_ID)}/messages`;
  try {
    const sent = await Promise.all(to.map(async (number) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload(number, text)),
      });
      return response.ok;
    }));
    return { ok: sent.some(Boolean), delivered: sent.filter(Boolean).length, attempted: sent.length };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}
