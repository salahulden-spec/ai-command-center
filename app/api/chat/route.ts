import { streamText, convertToModelMessages, tool, type UIMessage } from "ai";
import { z } from "zod";
import { verifyOwnerIdToken } from "@/lib/firebase/verify-id-token";

const tools = {
  createProject: tool({
    description:
      "Create a new project to track a piece of work the user wants to build or manage.",
    inputSchema: z.object({
      name: z.string().describe("Short project name"),
      description: z.string().default("").describe("What the project is about"),
    }),
  }),
  createTask: tool({
    description: "Create a task, optionally attached to an existing project by its ID.",
    inputSchema: z.object({
      title: z.string().describe("What needs to be done"),
      projectId: z
        .string()
        .nullable()
        .default(null)
        .describe("The project's Firestore ID if this task belongs to one, otherwise null"),
    }),
  }),
  createReminder: tool({
    description: "Create a reminder for the user at a specific date and time.",
    inputSchema: z.object({
      text: z.string().describe("What to remind the user about"),
      dueAt: z.string().describe("ISO 8601 date-time when the reminder is due"),
    }),
  }),
};

const SYSTEM_PROMPT = `You are the assistant inside AI Command Center, the user's private executive assistant app.
You can create projects, tasks, and reminders using the available tools when the user asks you to.
Every tool call is queued for the user's review before anything is actually created unless they've enabled auto-execute mode — after calling a tool, briefly confirm what you did in plain language.
Keep responses concise and practical.`;

export async function POST(req: Request) {
  const isOwner = await verifyOwnerIdToken(req.headers.get("authorization"));
  if (!isOwner) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: "anthropic/claude-sonnet-4.6",
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools,
  });

  return result.toUIMessageStreamResponse();
}
