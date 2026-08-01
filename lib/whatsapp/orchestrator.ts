import { embed, generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { adminDb, AdminFieldValue, AdminTimestamp } from "@/lib/firebase/admin";
import { zonedTimeToUtc } from "./timezone";
import type { AiMode, PendingActionType } from "@/types";

const TIMEZONE = process.env.WHATSAPP_TIMEZONE || "UTC";

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
 * branch in chat/page.tsx, but as real server-side `execute` functions — a
 * WhatsApp message has no browser open to run the client-side tool-call
 * pattern the in-app chat depends on. Scoped to what a text message actually
 * needs (projects, tasks, reminders, people, memory) — saveDecision/
 * saveResearch/saveDocument/createWorkflow stay app-only for now.
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
          .describe("The project's Firestore ID, from listProjects — never guessed"),
      }),
      execute: async ({ title, projectId }) =>
        mutate(aiMode, "createTask", `create task "${title}"`, { title, projectId }, async () => {
          const ref = projectId
            ? db.collection("projects").doc(projectId).collection("tasks")
            : db.collection("tasks");
          await ref.add({
            title,
            description: "",
            status: "todo",
            priority: "medium",
            dueDate: null,
            projectId,
            source: "ai",
            createdAt: AdminFieldValue.serverTimestamp(),
            updatedAt: null,
          });
        }),
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

    completeTask: tool({
      description: "Mark an existing task as done. Look it up with listOpenTasks first.",
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
            const ref = projectId
              ? db.collection("projects").doc(projectId).collection("tasks").doc(taskId)
              : db.collection("tasks").doc(taskId);
            await ref.update({ status: "done", updatedAt: AdminFieldValue.serverTimestamp() });
          }
        ),
    }),

    completeReminder: tool({
      description: "Mark an existing reminder as done. Look it up with listPendingReminders first.",
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

    listProjects: tool({
      description: "List existing projects (id, name, status). Read-only, always runs immediately.",
      inputSchema: z.object({}),
      execute: async () => {
        const snap = await db.collection("projects").get();
        return snap.docs.map((d) => ({ id: d.id, name: d.data().name, status: d.data().status }));
      },
    }),

    listOpenTasks: tool({
      description: "List open (not-done) tasks across all projects and standalone. Read-only.",
      inputSchema: z.object({}),
      execute: async () => {
        // No `where` on the collection-group query, filtered in memory instead:
        // matches the pattern already used elsewhere in this app (Mind View,
        // the weekly review function) to avoid needing a composite index just
        // for an inequality filter.
        const snap = await db.collectionGroup("tasks").get();
        return snap.docs
          .filter((d) => d.data().status !== "done")
          .map((d) => ({ id: d.id, title: d.data().title, projectId: d.data().projectId ?? null }));
      },
    }),

    listPendingReminders: tool({
      description: "List pending (not-done) reminders. Read-only.",
      inputSchema: z.object({}),
      execute: async () => {
        const snap = await db.collection("reminders").where("status", "==", "pending").get();
        return snap.docs.map((d) => ({ id: d.id, text: d.data().text }));
      },
    }),
  };
}

function buildSystemPrompt(): string {
  const now = new Date();
  const local = now.toLocaleString("en-US", { timeZone: TIMEZONE, dateStyle: "full", timeStyle: "short" });
  return `You are the assistant behind AI Command Center, texting with its owner over WhatsApp — the only person who can reach you here.
The current date and time is ${local} (zone: ${TIMEZONE}). Use this as the reference point for any relative date/time ("tomorrow", "next Friday") — never guess a different year.
When creating a reminder, output dueAt as a plain local ISO 8601 date-time with no timezone suffix (e.g. "2026-08-01T09:00:00") — it will be interpreted in the zone above.
You can create projects, tasks, reminders, and contacts, and mark tasks/reminders done. The list* tools and searchMemory are read-only and always run immediately — use list* to resolve real IDs before referencing anything by name.
CRITICAL: IDs are opaque random Firestore strings — never construct or guess one. If an action needs an existing project/task/reminder's ID, call the matching list* tool first and use the exact id from its result.
Long-term memory: use searchMemory only when explicitly asked to recall something — never assume something is true from memory without having searched for it first. Use saveMemory only for something clearly durable (a standing preference, a fixed fact) — not routine task/project updates.
Reply like a text message: short, plain, no markdown formatting (this isn't a chat UI that renders it) — a sentence or two confirming what happened.`;
}

/** Runs one WhatsApp message through the assistant and returns the reply text. */
export async function runWhatsAppCommand(message: string): Promise<string> {
  const aiMode = await currentAiMode();

  const { text } = await generateText({
    model: "anthropic/claude-sonnet-4.6",
    system: buildSystemPrompt(),
    prompt: message,
    tools: buildTools(aiMode),
    stopWhen: stepCountIs(6),
  });

  return text.trim() || "Done.";
}
