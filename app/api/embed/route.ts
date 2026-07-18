import { embed } from "ai";
import { verifyOwnerIdToken } from "@/lib/firebase/verify-id-token";

export async function POST(req: Request) {
  const isOwner = await verifyOwnerIdToken(req.headers.get("authorization"));
  if (!isOwner) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { text }: { text: string } = await req.json();
  if (!text || typeof text !== "string") {
    return new Response("Missing text", { status: 400 });
  }

  const { embedding } = await embed({
    model: "openai/text-embedding-3-small",
    value: text,
  });

  return Response.json({ embedding });
}
