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
  saveMemory: tool({
    description:
      "Save a durable fact, preference, decision, or note about a person/company to long-term memory, for recall in future conversations. Only call this for things worth remembering long-term (e.g. \"I prefer dark mode\", \"my dentist's number is X\", \"we decided to launch in March\") — not for routine task/project chatter that's already captured elsewhere.",
    inputSchema: z.object({
      type: z
        .enum(["fact", "preference", "person", "company", "decision"])
        .describe("What kind of memory this is"),
      content: z.string().describe("The memory itself, written as a standalone statement"),
    }),
  }),
  searchMemory: tool({
    description:
      "Search long-term memory for facts, preferences, decisions, or notes relevant to a query. Read-only, always runs immediately. Use this when the user asks you to recall something from before (e.g. \"what did we decide about X\", \"do you remember...\") — never assume memory content without searching first.",
    inputSchema: z.object({
      query: z.string().describe("What to search for, in natural language"),
    }),
  }),
  saveDecision: tool({
    description:
      "Save a structured decision analysis (the options you compared and your recommendation) to a project's decision log, after presenting it in your response. Only offer this when the decision is tied to a specific project — call listProjects first to get its real id.",
    inputSchema: z.object({
      projectId: z.string().describe("The project's Firestore ID, from listProjects"),
      question: z.string().describe("The decision question being analyzed"),
      options: z
        .array(
          z.object({
            label: z.string(),
            pros: z.string(),
            cons: z.string(),
            cost: z.string(),
            time: z.string(),
            risk: z.string(),
            roi: z.string(),
          })
        )
        .describe("2-3 options that were compared"),
      recommended: z.string().describe("Label of the recommended option"),
      reasoning: z.string().describe("Why that option is recommended"),
      confidence: z.number().min(0).max(100).describe("Confidence percentage, 0-100"),
    }),
  }),
  saveResearch: tool({
    description:
      "Save a research finding or note to a project's research log (e.g. the user found a competitor site, shared an article, or reported findings). Only offer this when tied to a specific project — call listProjects first to get its real id.",
    inputSchema: z.object({
      projectId: z.string().describe("The project's Firestore ID, from listProjects"),
      title: z.string().describe("Short title for this research entry"),
      content: z.string().describe("The research content/summary"),
      links: z.array(z.string()).default([]).describe("Any URLs mentioned"),
      tags: z.array(z.string()).default([]).describe("Short topical tags"),
    }),
  }),
  saveDocument: tool({
    description:
      "File an already-analyzed document attachment (summary + extracted entities, shown earlier in this conversation as an attachment) into a project's Documents section. Only call this when the user explicitly asks to save/file/attach the document to a specific project — call listProjects first to get its real id.",
    inputSchema: z.object({
      projectId: z.string().describe("The project's Firestore ID, from listProjects"),
      fileName: z.string().describe("The attachment's file name, from the attachment context"),
      summary: z.string().describe("The summary already generated for this attachment"),
      entities: z
        .object({
          dates: z.array(z.string()).default([]),
          people: z.array(z.string()).default([]),
          companies: z.array(z.string()).default([]),
          tasks: z.array(z.string()).default([]),
        })
        .describe("The entities already extracted for this attachment"),
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
Every create/complete/saveMemory tool call is queued for the user's review before anything is actually applied unless they've enabled auto-execute mode — after calling a mutating tool, briefly confirm what you did in plain language.
Long-term memory: use searchMemory only when the user is explicitly asking you to recall or reference something from before — never search or inject memory automatically into unrelated requests, and never assume something is true from memory without having actually searched for it in this conversation. Use saveMemory when the user shares something clearly durable (a standing preference, a fixed fact, a decision) — not for routine task/project updates that already live in their own records.
Strategic decisions: when the user asks something like "how should I approach X" / "what's the best way to do Y" / "should I do A or B", structure your answer as 2-3 named options, each with pros, cons, cost, time, risk, and ROI, followed by a clear recommendation with reasoning and a confidence percentage. If the question is clearly about a specific project, offer to save the analysis with saveDecision (resolve the project id via listProjects first) — don't save silently, mention you're doing it.
Research: when the user shares something they found (a competitor, an article, a data point) in the context of a specific project, offer to log it with saveResearch the same way — resolve the project id first, mention what you're doing.
Document attachments: when a message contains an "[Attached file: ...]" block, its summary and extracted entities were already generated — discuss it naturally, don't re-summarize it verbatim. Only call saveDocument if the user explicitly asks to file/save/attach it to a project (resolve the project id via listProjects first); otherwise treat it as one-off context for the conversation.
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
