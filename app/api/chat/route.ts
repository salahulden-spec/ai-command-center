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

function buildSystemPrompt() {
  const now = new Date();
  return `You are the assistant inside AI Command Center, the user's private executive assistant app.
The current date and time is ${now.toISOString()} (${now.toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}). Use this as the reference point for any relative date/time the user mentions (e.g. "tomorrow", "next Friday") — never guess or assume a different year.
When creating a reminder, output dueAt as a plain ISO 8601 local date-time without a timezone suffix (e.g. "2026-07-19T09:00:00"), reflecting the user's own wall-clock time, not UTC.
You can create projects, tasks, and reminders using the available tools when the user asks you to.
Every tool call is queued for the user's review before anything is actually created unless they've enabled auto-execute mode — after calling a tool, briefly confirm what you did in plain language.
Keep responses concise and practical.`;
}

export async function POST(req: Request) {
  const isOwner = await verifyOwnerIdToken(req.headers.get("authorization"));
  if (!isOwner) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: "anthropic/claude-sonnet-4.6",
    system: buildSystemPrompt(),
    messages: await convertToModelMessages(messages),
    tools,
  });

  return result.toUIMessageStreamResponse();
}
