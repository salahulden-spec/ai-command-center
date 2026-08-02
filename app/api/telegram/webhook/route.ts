import { runAssistantCommand } from "@/lib/assistant/orchestrator";

interface TelegramUpdate {
  message?: {
    text?: string;
    chat: { id: number };
    from?: { id: number };
  };
}

const HELP_TEXT = `I'm your Command Center. Just talk normally — no commands to memorise.

Things you can say:
"Add a task to call the supplier tomorrow"
"Start a project called Warehouse Move"
"Mark the quotation task done"
"Remind me Sunday 8am to send the invoice"
"Bump that to high priority"
"Save this: Kutty prefers email over calls"
"What's on today?"

I remember the last few messages, so follow-ups work. Send /reset to start a clean thread.`;

/**
 * Telegram's webhook for the bot. Two gates before anything reaches the AI:
 * the request must carry the secret token chosen when the webhook was
 * registered (proves it's genuinely Telegram calling, for this bot — Telegram
 * echoes it back as a header on every call), and the sender's numeric
 * Telegram id must match the owner's own (env var) — same reasoning as the
 * WhatsApp phone-number check in the other webhook.
 *
 * Replies via the "webhook reply" trick (a JSON `method` in the HTTP
 * response) instead of a separate authenticated call to Telegram's API —
 * Telegram already knows which bot this is from the URL itself, so no bot
 * token is needed server-side at all.
 */
export async function POST(req: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!expectedSecret || !ownerChatId) {
    console.error("Telegram webhook hit but TELEGRAM_WEBHOOK_SECRET/TELEGRAM_OWNER_CHAT_ID not configured");
    return new Response("Not configured", { status: 500 });
  }

  const gotSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (gotSecret !== expectedSecret) {
    return new Response("Invalid secret", { status: 403 });
  }

  const update: TelegramUpdate = await req.json();
  const chatId = update.message?.chat.id;
  const senderId = update.message?.from?.id;
  const text = update.message?.text?.trim();

  if (!chatId || String(senderId) !== ownerChatId) {
    // Not the owner (or not a plain text message, e.g. a sticker/photo) —
    // acknowledge with no reply, same as the WhatsApp webhook's stance on
    // messages from anyone but the owner.
    return new Response(null, { status: 200 });
  }

  if (!text) {
    return Response.json({
      method: "sendMessage",
      chat_id: chatId,
      text: "Send me a task, project, reminder, or contact to add.",
    });
  }

  if (/^\/start\b/.test(text)) {
    return Response.json({
      method: "sendMessage",
      chat_id: chatId,
      text: HELP_TEXT,
    });
  }

  try {
    // Keyed on the chat so the assistant carries recent history and short
    // follow-ups ("make it high priority") resolve against what came before.
    const reply = await runAssistantCommand(text, { threadKey: `telegram:${chatId}` });
    return Response.json({ method: "sendMessage", chat_id: chatId, text: reply });
  } catch (err) {
    console.error("Telegram command failed:", err);
    return Response.json({
      method: "sendMessage",
      chat_id: chatId,
      text: "Something went wrong on my end — try again in a moment.",
    });
  }
}
