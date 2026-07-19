import { generateObject } from "ai";
import { z } from "zod";
import { verifyOwnerIdToken } from "@/lib/firebase/verify-id-token";

const resultSchema = z.object({
  summary: z.string().describe("A concise 2-4 sentence summary of the document's content and purpose"),
  entities: z.object({
    dates: z.array(z.string()).describe("Notable dates or deadlines mentioned"),
    people: z.array(z.string()).describe("Names of people mentioned"),
    companies: z.array(z.string()).describe("Companies or organizations mentioned"),
    tasks: z.array(z.string()).describe("Action items or tasks implied or stated in the document"),
  }),
});

const PROMPT =
  "Analyze this document and extract a concise summary plus any notable dates, people, companies, and action items/tasks. If a category has nothing relevant, return an empty array for it.";

export async function POST(req: Request) {
  const isOwner = await verifyOwnerIdToken(req.headers.get("authorization"));
  if (!isOwner) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body: { text?: string; fileUrl?: string; mediaType?: string } = await req.json();

  const { object } = await generateObject({
    model: "anthropic/claude-sonnet-4.6",
    schema: resultSchema,
    messages: [
      {
        role: "user",
        content: body.fileUrl
          ? [
              { type: "file", data: new URL(body.fileUrl), mediaType: body.mediaType ?? "application/octet-stream" },
              { type: "text", text: PROMPT },
            ]
          : [{ type: "text", text: `${PROMPT}\n\nDocument content:\n\n${body.text ?? ""}` }],
      },
    ],
  });

  return Response.json(object);
}
