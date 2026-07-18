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
  listProjects: tool({
    description:
      "List the user's existing projects (id, name, status). Call this before creating a task that should attach to a project, so you can resolve the project name the user mentions to its real ID — never invent a project ID.",
    inputSchema: z.object({}),
  }),
  listOpenTasks: tool({
    description:
      "List the user's open (not-done) tasks across all projects and standalone tasks, so you can find the right task when the user asks to complete or reference one by description.",
    inputSchema: z.object({}),
  }),
  listPendingReminders: tool({
    description: "List the user's pending (not-done) reminders.",
    inputSchema: z.object({}),
  }),
  completeTask: tool({
    description: "Mark an existing task as done. Look it up with listOpenTasks first.",
    inputSchema: z.object({
      taskId: z.string().describe("The task's Firestore ID, from listOpenTasks"),
      projectId: z
        .string()
        .nullable()
        .describe("The task's projectId as returned by listOpenTasks, or null if standalone"),
      taskTitle: z.string().describe("The task's title, for display in the confirmation UI"),
    }),
  }),
  completeReminder: tool({
    description: "Mark an existing reminder as done. Look it up with listPendingReminders first.",
    inputSchema: z.object({
      reminderId: z.string().describe("The reminder's Firestore ID, from listPendingReminders"),
      reminderText: z.string().describe("The reminder's text, for display in the confirmation UI"),
    }),
  }),
};

function buildSystemPrompt() {
  const now = new Date();
  return `You are the assistant inside AI Command Center, the user's private executive assistant app.
The current date and time is ${now.toISOString()} (${now.toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}). Use this as the reference point for any relative date/time the user mentions (e.g. "tomorrow", "next Friday") — never guess or assume a different year.
When creating a reminder, output dueAt as a plain ISO 8601 local date-time without a timezone suffix (e.g. "2026-07-19T09:00:00"), reflecting the user's own wall-clock time, not UTC.
You can create projects, tasks, and reminders, and mark tasks/reminders complete, using the available tools when the user asks you to.
The list* tools (listProjects, listOpenTasks, listPendingReminders) are read-only and always run immediately — use them freely to look up real IDs before referencing a project, task, or reminder by name.
CRITICAL: IDs are opaque random Firestore strings (e.g. "e3QIlmSjbpg46UHWRt0Q") — never construct, guess, or slugify one from a name (e.g. "websiteRedesignId" is never valid). If a task requires an existing project/task/reminder's ID and you have not just seen it in an actual tool result, call the matching list* tool FIRST, wait for its real output, and only then call the mutating tool with the exact id string from that result — do not call the lookup and the action that depends on it in the same step.
Every create/complete tool call is queued for the user's review before anything is actually applied unless they've enabled auto-execute mode — after calling a mutating tool, briefly confirm what you did in plain language.
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
