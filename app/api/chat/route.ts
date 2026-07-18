import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { verifyOwnerIdToken } from "@/lib/firebase/verify-id-token";

export async function POST(req: Request) {
  const isOwner = await verifyOwnerIdToken(req.headers.get("authorization"));
  if (!isOwner) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: "anthropic/claude-sonnet-4.6",
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
