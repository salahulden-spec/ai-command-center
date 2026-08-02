/**
 * Sends a WhatsApp reply via Meta's Graph API.
 *
 * Unlike Twilio (inline TwiML reply) or Telegram (the "webhook reply" JSON
 * trick), Meta's Cloud API has no way to reply inside the webhook response
 * itself — every outbound message is its own authenticated call.
 */
export async function sendMetaWhatsAppMessage(to: string, text: string): Promise<void> {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    throw new Error("META_PHONE_NUMBER_ID/META_ACCESS_TOKEN not configured");
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    throw new Error(`Meta send failed (${res.status}): ${await res.text()}`);
  }
}
