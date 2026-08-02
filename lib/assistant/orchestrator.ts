import { embed, generateText, tool, stepCountIs, type ModelMessage } from "ai";
import { z } from "zod";
import { adminDb, AdminFieldValue, AdminTimestamp } from "@/lib/firebase/admin";
import { zonedTimeToUtc } from "./timezone";
import { loadWorkspaceSnapshot } from "./context";
import { CAPTURE_POLICY } from "./capture-policy";
import { loadThread, appendTurns, clearThread, type Turn } from "./thread";
import type { AiMode, PendingActionType } from "@/types";

const TIMEZONE = process.env.ASSISTANT_TIMEZONE || "UTC";

/** Keeps replies text-message length instead of essay length. */
const MAX_OUTPUT_TOKENS = 400;

// Duplicated from lib/firestore/memory.ts rather than imported: that module
// pulls in the client Firebase SDK, which server-only code has no reason to
// depend on just to reuse an 8-line pure function.
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Mirrors the mutating side of app/api/chat/route.ts + the client execute-mode
 * branch in chat/page.tsx, but as real server-side `execute` functions.
 *
 * Shared by every text-message front door (WhatsApp, Telegram, ...): none of
 * them have a browser open to run the client-side tool-call pattern the
 * in-app chat depends on, and a message is a message regardless of which app
 * it arrived on — the webhook route for each platform only needs to verify
 * the sender and hand the text off to `runAssistantCommand` below.
 *
 * Scoped to what a text command actually needs (projects, tasks, reminders,
 * people, inbox, memory) — saveDecision/saveResearch/saveDocument/createWorkflow
 * stay app-only for now.
 */
async function currentAiMode(): Promise<AiMode> {
  const snap = await adminDb().collection("users").limit(1).get();
  return (snap.docs[0]?.data().aiMode as AiMode | undefined) ?? "ask";
}

async function queuePendingAction(
  actionType: PendingActionType,
  summary: string,
  payload: Record<string, unknown>
) {
  await adminDb().collection("pendingActions").add({
    actionType,
    summary,
    payload,
    status: "pending",
    createdAt: AdminFieldValue.serverTimestamp(),
  });
}

/** Runs `direct` immediately in execute mode, otherwise queues it for in-app approval. */
async function mutate(
  aiMode: AiMode,
  actionType: PendingActionType,
  summary: string,
  payload: Record<string, unknown>,
  direct: () => Promise<void>
): Promise<string> {
  if (aiMode === "execute") {
    await direct();
    return `Done — ${summary}.`;
  }
  await queuePendingAction(actionType, summary, payload);
  return `Queued for your approval in the app — ${summary}.`;
}

/** Resolves the right tasks collection: a project's subcollection, or the standalone root one. */
function tasksRef(projectId: string | null) {
  const db = adminDb();
  return projectId
    ? db.collection("projects").doc(projectId).collection("tasks")
    : db.collection("tasks");
}

function buildTools(aiMode: AiMode) {
  const db = adminDb();

  return {
    createProject: tool({
      description: "Create a new project.",
      inputSchema: z.object({
        name: z.string().describe("Short project name"),
        description: z.string().default("").describe("What the project is about"),
      }),
      execute: async ({ name, description }) =>
        mutate(aiMode, "createProject", `create project "${name}"`, { name, description }, async () => {
          await db.collection("projects").add({
            name,
            description,
            status: "active",
            objectives: [],
            progress: 0,
            createdAt: AdminFieldValue.serverTimestamp(),
            updatedAt: AdminFieldValue.serverTimestamp(),
          });
        }),
    }),

    createTask: tool({
      description: "Create a task, optionally attached to an existing project by its ID.",
      inputSchema: z.object({
        title: z.string(),
        projectId: z
          .string()
          .nullable()
          .default(null)
          .describe("The project's Firestore ID, copied from the workspace snapshot — never guessed"),
        priority: z.enum(["low", "medium", "high"]).default("medium"),
        dueDate: z
          .string()
          .nullable()
          .default(null)
          .describe('Optional local ISO 8601 date-time with no timezone suffix, e.g. "2026-08-05T17:00:00"'),
      }),
      execute: async ({ title, projectId, priority, dueDate }) =>
        mutate(
          aiMode,
          "createTask",
          `create task "${title}"`,
          { title, projectId, priority, dueDate },
          async () => {
            await tasksRef(projectId).add({
              title,
              description: "",
              status: "todo",
              priority,
              dueDate: dueDate ? AdminTimestamp.fromDate(zonedTimeToUtc(dueDate, TIMEZONE)) : null,
              projectId,
              source: "ai",
              createdAt: AdminFieldValue.serverTimestamp(),
              updatedAt: null,
            });
          }
        ),
    }),

    updateTask: tool({
      description:
        "Change an existing task's title, status, priority, or due date. Use the task's ID from the workspace snapshot. Only pass the fields that should change.",
      inputSchema: z.object({
        taskId: z.string(),
        projectId: z.string().nullable().describe("The task's project ID, or null if standalone"),
        taskTitle: z.string().describe("The task's current title, for the confirmation message"),
        title: z.string().nullable().default(null),
        status: z.enum(["todo", "doing", "blocked", "done"]).nullable().default(null),
        priority: z.enum(["low", "medium", "high"]).nullable().default(null),
        dueDate: z
          .string()
          .nullable()
          .default(null)
          .describe("Local ISO 8601 date-time with no timezone suffix"),
      }),
      execute: async ({ taskId, projectId, taskTitle, title, status, priority, dueDate }) => {
        const changes: string[] = [];
        if (title) changes.push(`renamed to "${title}"`);
        if (status) changes.push(`status ${status}`);
        if (priority) changes.push(`priority ${priority}`);
        if (dueDate) changes.push(`due ${dueDate}`);
        if (!changes.length) return "Nothing to change — no fields were provided.";

        return mutate(
          aiMode,
          "updateTask",
          `update task "${taskTitle}" (${changes.join(", ")})`,
          { taskId, projectId, title, status, priority, dueDate },
          async () => {
            const updates: Record<string, unknown> = {
              updatedAt: AdminFieldValue.serverTimestamp(),
            };
            if (title) updates.title = title;
            if (status) updates.status = status;
            if (priority) updates.priority = priority;
            if (dueDate) updates.dueDate = AdminTimestamp.fromDate(zonedTimeToUtc(dueDate, TIMEZONE));
            await tasksRef(projectId).doc(taskId).update(updates);
          }
        );
      },
    }),

    deleteTask: tool({
      description:
        "Permanently delete a task the user no longer wants at all. For finishing a task use updateTask with status done instead.",
      inputSchema: z.object({
        taskId: z.string(),
        projectId: z.string().nullable(),
        taskTitle: z.string().describe("For the confirmation message"),
      }),
      execute: async ({ taskId, projectId, taskTitle }) =>
        mutate(
          aiMode,
          "deleteTask",
          `delete task "${taskTitle}"`,
          { taskId, projectId },
          async () => {
            await tasksRef(projectId).doc(taskId).delete();
          }
        ),
    }),

    updateProject: tool({
      description:
        "Change an existing project's status, progress percentage, or description. Only pass the fields that should change.",
      inputSchema: z.object({
        projectId: z.string(),
        projectName: z.string().describe("For the confirmation message"),
        status: z.enum(["active", "blocked", "paused", "done", "archived"]).nullable().default(null),
        progress: z.number().min(0).max(100).nullable().default(null),
        description: z.string().nullable().default(null),
      }),
      execute: async ({ projectId, projectName, status, progress, description }) => {
        const changes: string[] = [];
        if (status) changes.push(`status ${status}`);
        if (progress !== null) changes.push(`${progress}% done`);
        if (description) changes.push("new description");
        if (!changes.length) return "Nothing to change — no fields were provided.";

        return mutate(
          aiMode,
          "updateProject",
          `update project "${projectName}" (${changes.join(", ")})`,
          { projectId, status, progress, description },
          async () => {
            const updates: Record<string, unknown> = {
              updatedAt: AdminFieldValue.serverTimestamp(),
            };
            if (status) updates.status = status;
            if (progress !== null) updates.progress = progress;
            if (description) updates.description = description;
            await db.collection("projects").doc(projectId).update(updates);
          }
        );
      },
    }),

    createReminder: tool({
      description: "Create a reminder for the user at a specific date and time.",
      inputSchema: z.object({
        text: z.string(),
        dueAt: z
          .string()
          .describe(
            'ISO 8601 local date-time with no timezone suffix (e.g. "2026-08-01T09:00:00"), in the user\'s own wall-clock time'
          ),
      }),
      execute: async ({ text, dueAt }) => {
        const due = zonedTimeToUtc(dueAt, TIMEZONE);
        return mutate(aiMode, "createReminder", `remind: "${text}"`, { text, dueAt }, async () => {
          await db.collection("reminders").add({
            text,
            dueAt: AdminTimestamp.fromDate(due),
            status: "pending",
            relatedProjectId: null,
            notifiedAt: null,
            createdAt: AdminFieldValue.serverTimestamp(),
          });
        });
      },
    }),

    createPerson: tool({
      description: "Save a person to the user's contacts.",
      inputSchema: z.object({
        name: z.string(),
        company: z.string().default(""),
        notes: z.string().default(""),
      }),
      execute: async ({ name, company, notes }) =>
        mutate(aiMode, "createPerson", `add contact "${name}"`, { name, company, notes }, async () => {
          await db.collection("people").add({
            name,
            company,
            notes,
            createdAt: AdminFieldValue.serverTimestamp(),
          });
        }),
    }),

    updatePerson: tool({
      description:
        "Enrich an existing contact: append to their notes, set their company, or rename them. Always prefer this over createPerson when the person is already in the workspace snapshot. Renaming is how someone first recorded by role ('my boss') becomes their real name once you learn it.",
      inputSchema: z.object({
        personId: z.string(),
        personName: z.string().describe("Their current name, for the confirmation message"),
        appendNote: z.string().nullable().default(null),
        company: z.string().nullable().default(null),
        name: z.string().nullable().default(null).describe("A new name, to rename this contact"),
      }),
      execute: async ({ personId, personName, appendNote, company, name }) => {
        if (!appendNote && !company && !name) {
          return "Nothing to change — no fields were provided.";
        }
        return mutate(
          aiMode,
          "updatePerson",
          name ? `rename contact "${personName}" to "${name}"` : `update contact "${personName}"`,
          { personId, appendNote, company, name },
          async () => {
            const ref = db.collection("people").doc(personId);
            const updates: Record<string, unknown> = {};
            if (name) updates.name = name;
            if (company) updates.company = company;
            if (appendNote) {
              const existing = ((await ref.get()).data()?.notes as string | undefined) ?? "";
              updates.notes = existing ? `${existing}\n${appendNote}` : appendNote;
            }
            await ref.update(updates);
          }
        );
      },
    }),

    captureNote: tool({
      description:
        "Drop a raw thought, link, or scrap of information into the inbox to sort out later. Use this when the user is capturing something rather than asking for a task, project, or reminder — it is the catch-all for 'remember this for now'.",
      inputSchema: z.object({
        content: z.string(),
        type: z.enum(["note", "link"]).default("note"),
      }),
      execute: async ({ content, type }) =>
        mutate(
          aiMode,
          "captureNote",
          `save to inbox: "${content.slice(0, 60)}"`,
          { content, type },
          async () => {
            await db.collection("inbox").add({
              type,
              content,
              status: "unprocessed",
              createdAt: AdminFieldValue.serverTimestamp(),
            });
          }
        ),
    }),

    completeTask: tool({
      description: "Mark an existing task as done, by its ID from the workspace snapshot.",
      inputSchema: z.object({
        taskId: z.string(),
        projectId: z.string().nullable(),
        taskTitle: z.string().describe("For the confirmation message"),
      }),
      execute: async ({ taskId, projectId, taskTitle }) =>
        mutate(
          aiMode,
          "completeTask",
          `mark task "${taskTitle}" done`,
          { taskId, projectId },
          async () => {
            await tasksRef(projectId).doc(taskId).update({
              status: "done",
              updatedAt: AdminFieldValue.serverTimestamp(),
            });
          }
        ),
    }),

    completeReminder: tool({
      description: "Mark an existing reminder as done, by its ID from the workspace snapshot.",
      inputSchema: z.object({
        reminderId: z.string(),
        reminderText: z.string().describe("For the confirmation message"),
      }),
      execute: async ({ reminderId, reminderText }) =>
        mutate(
          aiMode,
          "completeReminder",
          `mark reminder "${reminderText}" done`,
          { reminderId },
          async () => {
            await db.collection("reminders").doc(reminderId).update({ status: "done" });
          }
        ),
    }),

    saveMemory: tool({
      description:
        "Save a durable fact or preference worth recalling later — not routine task/project chatter.",
      inputSchema: z.object({
        type: z.enum(["fact", "preference", "person", "company", "decision"]),
        content: z.string(),
      }),
      execute: async ({ type, content }) => {
        // Computed up front so it's captured in the payload whether this runs
        // immediately or gets queued for approval — same reasoning as the
        // client's saveMemory handling in chat/page.tsx.
        const { embedding } = await embed({ model: "openai/text-embedding-3-small", value: content });
        return mutate(
          aiMode,
          "saveMemory",
          `remember: "${content}"`,
          { type, content, embedding },
          async () => {
            await db.collection("memory").add({
              type,
              content,
              embedding,
              relatedProjectId: null,
              source: "ai",
              createdAt: AdminFieldValue.serverTimestamp(),
            });
          }
        );
      },
    }),

    searchMemory: tool({
      description:
        "Search long-term memory for facts, preferences, or decisions relevant to a query. Read-only. Use only when the user is explicitly asking you to recall something — never assume something is true from memory without searching first.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const { embedding: queryEmbedding } = await embed({
          model: "openai/text-embedding-3-small",
          value: query,
        });
        const snap = await db.collection("memory").get();
        return snap.docs
          .map((d) => {
            const data = d.data();
            const embedding = (data.embedding as number[] | undefined) ?? [];
            return {
              content: data.content as string,
              similarity: embedding.length ? cosineSimilarity(queryEmbedding, embedding) : 0,
            };
          })
          .filter((m) => m.similarity > 0.3)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 5)
          .map((m) => m.content);
      },
    }),

    listDoneTasks: tool({
      description:
        "List recently completed tasks. Read-only. The workspace snapshot only carries open tasks, so use this when the user asks what they finished.",
      inputSchema: z.object({}),
      execute: async () => {
        const snap = await db.collectionGroup("tasks").get();
        return snap.docs
          .filter((d) => d.data().status === "done")
          .slice(0, 25)
          .map((d) => ({ id: d.id, title: d.data().title }));
      },
    }),

    listInbox: tool({
      description: "List unprocessed inbox items. Read-only.",
      inputSchema: z.object({}),
      execute: async () => {
        const snap = await db.collection("inbox").where("status", "==", "unprocessed").get();
        return snap.docs.map((d) => ({ id: d.id, content: d.data().content }));
      },
    }),
  };
}

function buildSystemPrompt(snapshot: string): string {
  const now = new Date();
  const local = now.toLocaleString("en-US", {
    timeZone: TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  });

  return `You are the assistant behind AI Command Center, texting with its owner — the only person who can reach you here.

The current date and time is ${local} (zone: ${TIMEZONE}). Use this as the reference point for any relative date/time ("tomorrow", "next Friday") — never guess a different year. When a tool asks for a date-time, output plain local ISO 8601 with no timezone suffix (e.g. "2026-08-01T09:00:00").

Here is the owner's live workspace right now:

${snapshot}

Those IDs are real — copy them exactly when a tool needs one. Never invent or construct an ID. If something the user mentions isn't listed above, say so rather than guessing which item they meant; ask a short clarifying question when two items could plausibly match.

You can create and update projects, tasks, reminders, and contacts, mark things done, delete a task, capture notes to the inbox, and remember durable facts. Prefer captureNote when the user is just dumping a thought rather than assigning work.

${CAPTURE_POLICY}

Long-term memory: use searchMemory only when explicitly asked to recall something — never assume something is true from memory without having searched for it first. Use saveMemory only for something clearly durable (a standing preference, a fixed fact) — not routine task/project updates.

You have the recent conversation history, so short follow-ups ("make it high priority", "that one too", "actually tomorrow instead") refer to what was just discussed — resolve them against it rather than asking the user to repeat themselves.

Reply like a text message: short, plain, no markdown formatting (this isn't a chat UI that renders it) — a sentence or two confirming what happened. When listing several things, use short plain lines, not bullets or bold.`;
}

export interface AssistantCommandOptions {
  /**
   * Identifies the conversation to carry history on — the platform chat id
   * (e.g. "telegram:12345"). Omit for a one-shot command with no memory.
   */
  threadKey?: string;
}

/** Runs one inbound text command through the assistant and returns the reply text. */
export async function runAssistantCommand(
  message: string,
  options: AssistantCommandOptions = {}
): Promise<string> {
  const { threadKey } = options;

  // "/reset" is handled here rather than by the model: the whole point is to
  // discard the history the model would otherwise be reading.
  if (threadKey && /^\/(reset|clear|new)\b/i.test(message.trim())) {
    await clearThread(threadKey);
    return "Fresh start — I've forgotten our recent thread. What's next?";
  }

  const [aiMode, snapshot, history] = await Promise.all([
    currentAiMode(),
    loadWorkspaceSnapshot(TIMEZONE),
    threadKey ? loadThread(threadKey) : Promise.resolve<Turn[]>([]),
  ]);

  const messages: ModelMessage[] = [...history, { role: "user", content: message }];

  const { text } = await generateText({
    model: "anthropic/claude-sonnet-4.6",
    system: buildSystemPrompt(snapshot),
    messages,
    tools: buildTools(aiMode),
    stopWhen: stepCountIs(6),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  const reply = text.trim() || "Done.";
  if (threadKey) await appendTurns(threadKey, history, message, reply);
  return reply;
}
