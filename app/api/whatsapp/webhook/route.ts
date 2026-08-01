// twilio is a CommonJS package; a named import only works if the bundler
// synthesizes one from module.exports. Using the default import instead
// avoids depending on that, since this signature check is a security boundary.
import twilioPkg from "twilio";
const { validateRequest } = twilioPkg;
import { runWhatsAppCommand } from "@/lib/whatsapp/orchestrator";

function twiml(message: string): Response {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
    { headers: { "Content-Type": "text/xml" } }
  );
}

/**
 * Twilio's "when a message comes in" webhook for the WhatsApp sender.
 *
 * Two independent gates before anything reaches the AI: the request must
 * carry a valid Twilio signature (proves it came from Twilio, not anyone who
 * finds this URL), and the WhatsApp `From` number must exactly match the
 * owner's own number (proves it's *the owner* texting, not another WhatsApp
 * user who's messaged the same Twilio sandbox/sender). Either failing means
 * silent rejection — no hint to a prober about which check failed.
 */
export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const ownerNumber = process.env.WHATSAPP_OWNER_NUMBER;
  if (!authToken || !ownerNumber) {
    console.error("WhatsApp webhook hit but TWILIO_AUTH_TOKEN/WHATSAPP_OWNER_NUMBER not configured");
    return new Response("Not configured", { status: 500 });
  }

  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  const signature = req.headers.get("X-Twilio-Signature") ?? "";
  const url = req.url;
  if (!validateRequest(authToken, signature, url, params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const from = params.From ?? "";
  if (from !== ownerNumber) {
    // Not an error — just someone else's message to the same Twilio number
    // (e.g. a stray sandbox join attempt). Reply with nothing.
    return new Response(null, { status: 204 });
  }

  const body = (params.Body ?? "").trim();
  if (!body) {
    return twiml("Send me a task, project, reminder, or contact to add.");
  }

  try {
    const reply = await runWhatsAppCommand(body);
    return twiml(reply);
  } catch (err) {
    console.error("WhatsApp command failed:", err);
    return twiml("Something went wrong on my end — try again in a moment.");
  }
}
