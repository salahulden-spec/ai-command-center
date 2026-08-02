import { runAssistantCommand } from "@/lib/assistant/orchestrator";
import { verifyMetaSignature } from "@/lib/whatsapp/meta-signature";
import { sendMetaWhatsAppMessage } from "@/lib/whatsapp/meta-send";

interface MetaWebhookPayload {
  entry?: {
    changes?: {
      value?: {
        messages?: { from: string; type: string; text?: { body: string } }[];
      };
    }[];
  }[];
}

/**
 * One-time handshake Meta performs whenever the webhook URL is (re)configured
 * in the App Dashboard: it must see the exact `hub.verify_token` chosen there
 * echoed back, and the `hub.challenge` value returned verbatim as plain text.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Meta's webhook for incoming WhatsApp messages. Two independent gates before
 * anything reaches the AI: the request must carry a valid `X-Hub-Signature-256`
 * (proves it came from Meta, for this app — not anyone who finds the URL),
 * and the sender's WhatsApp number must exactly match the owner's own number
 * (proves it's *the owner* texting, not some other WhatsApp user who's messaged
 * the same test number). Either failing means silent rejection.
 */
export async function POST(req: Request) {
  const appSecret = process.env.META_APP_SECRET;
  const ownerNumber = process.env.WHATSAPP_OWNER_NUMBER;
  if (!appSecret || !ownerNumber) {
    console.error("WhatsApp webhook hit but META_APP_SECRET/WHATSAPP_OWNER_NUMBER not configured");
    return new Response("Not configured", { status: 500 });
  }

  const rawBody = await req.text();
  if (!verifyMetaSignature(appSecret, req.headers.get("X-Hub-Signature-256"), rawBody)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const payload: MetaWebhookPayload = JSON.parse(rawBody);
  const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  // Meta also posts delivery/read status updates through this same webhook —
  // those have no `messages` array. Nothing to do but acknowledge them.
  if (!message) return new Response(null, { status: 200 });

  if (message.from !== ownerNumber) {
    return new Response(null, { status: 200 });
  }

  const text = message.type === "text" ? message.text?.body.trim() : undefined;
  if (!text) {
    await sendMetaWhatsAppMessage(
      message.from,
      "Send me a task, project, reminder, or contact to add — text only for now."
    );
    return new Response(null, { status: 200 });
  }

  try {
    const reply = await runAssistantCommand(text, { threadKey: `whatsapp:${message.from}` });
    await sendMetaWhatsAppMessage(message.from, reply);
  } catch (err) {
    console.error("WhatsApp command failed:", err);
    await sendMetaWhatsAppMessage(message.from, "Something went wrong on my end — try again in a moment.");
  }

  // Meta expects a fast 200 regardless of how the reply above went — it
  // retries the whole webhook delivery on non-2xx, which would re-run the
  // command (and could double-execute a task/reminder creation).
  return new Response(null, { status: 200 });
}
