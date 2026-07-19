"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { onSnapshot } from "firebase/firestore";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { auth } from "@/lib/firebase/client";
import { Markdown } from "@/components/chat/markdown";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { userSettingsRef } from "@/lib/firestore/user-settings";
import {
  pendingActionsQuery,
  queuePendingAction,
  approvePendingAction,
  rejectPendingAction,
} from "@/lib/firestore/pending-actions";
import { createProject, listProjectsOnce } from "@/lib/firestore/projects";
import { createTask, updateTaskStatus, listOpenTasksOnce } from "@/lib/firestore/tasks";
import {
  createReminder,
  markReminderDone,
  listPendingRemindersOnce,
} from "@/lib/firestore/reminders";
import { createMemory, listMemoriesOnce, cosineSimilarity } from "@/lib/firestore/memory";
import { createDecision } from "@/lib/firestore/decisions";
import { createResearchEntry } from "@/lib/firestore/research";
import { embedText } from "@/lib/ai/embed-client";
import {
  createConversation,
  updateConversationMessages,
  getConversationOnce,
} from "@/lib/firestore/conversations";
import type { AiMode, DecisionOption, MemoryType, PendingActionType } from "@/types";

const READ_TOOLS = new Set([
  "listProjects",
  "listOpenTasks",
  "listPendingReminders",
  "searchMemory",
]);

/**
 * The AI SDK awaits onToolCall before it can process any later stream
 * chunk — a hung Firestore call inside it silently freezes the whole
 * chat with no error surfaced. Bound every await chain in onToolCall so
 * a stall degrades into a visible error instead.
 *
 * Do NOT also `await addToolResult(...)` as a way to make this safer:
 * addToolResult queues its state update on the SDK's own SerialJobExecutor,
 * the same queue onToolCall's containing job runs on. Awaiting it from
 * inside onToolCall deadlocks — that job can't advance until the queued
 * addToolResult job runs, which can't run until the current job (the one
 * doing the awaiting) finishes. Fire-and-forget addToolResult calls here
 * are intentional, not an oversight.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out.")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * The model can hallucinate plausible-looking IDs (e.g. a slug like
 * "websiteRedesignId" instead of a real Firestore auto-ID) instead of
 * using the exact id from a prior list* tool result — this happens when
 * it calls a lookup and a mutation in the same step without actually
 * waiting on the lookup's real output. Never trust a referenced ID
 * without checking it exists first; on mismatch, return an error the
 * model can use to retry instead of silently writing to a bogus path.
 */
async function validateReference(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string | null> {
  if (toolName === "createTask" && toolInput.projectId) {
    const projects = await listProjectsOnce();
    if (!projects.some((p) => p.id === toolInput.projectId)) {
      return `No project exists with id "${toolInput.projectId}". Call listProjects and use one of the exact ids it returns — never construct or guess an id.`;
    }
  }
  if (toolName === "completeTask") {
    const tasks = await listOpenTasksOnce();
    if (!tasks.some((t) => t.id === toolInput.taskId)) {
      return `No open task exists with id "${toolInput.taskId}". Call listOpenTasks and use one of the exact ids it returns.`;
    }
  }
  if (toolName === "completeReminder") {
    const reminders = await listPendingRemindersOnce();
    if (!reminders.some((r) => r.id === toolInput.reminderId)) {
      return `No pending reminder exists with id "${toolInput.reminderId}". Call listPendingReminders and use one of the exact ids it returns.`;
    }
  }
  if (toolName === "saveDecision" || toolName === "saveResearch") {
    const projects = await listProjectsOnce();
    if (!projects.some((p) => p.id === toolInput.projectId)) {
      return `No project exists with id "${toolInput.projectId}". Call listProjects and use one of the exact ids it returns — never construct or guess an id.`;
    }
  }
  return null;
}

function summarizeAction(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "createProject":
      return `Create project "${input.name}"`;
    case "createTask":
      return `Create task "${input.title}"`;
    case "createReminder":
      return `Remind: "${input.text}"`;
    case "completeTask":
      return `Mark task "${input.taskTitle}" as done`;
    case "completeReminder":
      return `Mark reminder "${input.reminderText}" as done`;
    case "saveMemory":
      return `Remember: "${input.content}"`;
    case "saveDecision":
      return `Log decision: "${input.question}" → ${input.recommended}`;
    case "saveResearch":
      return `Log research: "${input.title}"`;
    default:
      return toolName;
  }
}

export default function ChatPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[calc(100vh-8.5rem)] w-full" />}>
      <ChatPageLoader />
    </Suspense>
  );
}

/** Resolves the initial message list (from a past conversation, if ?id= is present) before mounting the actual chat UI — useChat only reads its initial messages once, on mount. */
function ChatPageLoader() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("id");
  const initialText = searchParams.get("q");
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    if (!conversationId) {
      setInitialMessages([]);
      setReady(true);
      return;
    }
    getConversationOnce(conversationId).then((messages) => {
      if (cancelled) return;
      setInitialMessages(messages ?? []);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  if (!ready || initialMessages === null) {
    return <Skeleton className="h-[calc(100vh-8.5rem)] w-full" />;
  }

  return (
    <ChatConversation
      key={conversationId ?? "new"}
      conversationId={conversationId}
      initialMessages={initialMessages}
      initialText={initialText}
    />
  );
}

function ChatConversation({
  conversationId: initialConversationId,
  initialMessages,
  initialText,
}: {
  conversationId: string | null;
  initialMessages: UIMessage[];
  initialText: string | null;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [aiMode, setLocalAiMode] = useState<AiMode>("ask");
  const conversationIdRef = useRef(initialConversationId);
  const autoSentRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(userSettingsRef(user.uid), (snap) => {
      setLocalAiMode(snap.data()?.aiMode ?? "ask");
    });
  }, [user]);

  const { data: pendingActions } = useCollection(useMemo(() => pendingActionsQuery(), []));

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: async (): Promise<Record<string, string>> => {
          const token = await auth.currentUser?.getIdToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    []
  );

  const { messages, sendMessage, status, error, addToolResult } = useChat({
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (err) => {
      console.error("Chat error:", err);
    },
    onFinish: ({ messages: finished }) => {
      if (conversationIdRef.current) {
        void updateConversationMessages(conversationIdRef.current, finished);
      } else {
        void createConversation(finished).then((id) => {
          conversationIdRef.current = id;
          router.replace(`/chat?id=${id}`, { scroll: false });
        });
      }
    },
    onToolCall: async ({ toolCall }) => {
      const { toolCallId, toolName, input: toolInput } = toolCall as {
        toolCallId: string;
        toolName: string;
        input: Record<string, unknown>;
      };

      if (READ_TOOLS.has(toolName)) {
        try {
          let output: unknown;
          if (toolName === "listProjects") {
            output = (await listProjectsOnce()).map((p) => ({
              id: p.id,
              name: p.name,
              status: p.status,
            }));
          } else if (toolName === "listOpenTasks") {
            output = (await listOpenTasksOnce()).map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              projectId: t.projectId,
            }));
          } else if (toolName === "listPendingReminders") {
            output = (await listPendingRemindersOnce()).map((r) => ({
              id: r.id,
              text: r.text,
              dueAt: r.dueAt.toDate().toISOString(),
            }));
          } else if (toolName === "searchMemory") {
            const { query } = toolInput as { query: string };
            const [queryEmbedding, memories] = await Promise.all([
              embedText(query),
              listMemoriesOnce(),
            ]);
            output = memories
              .map((m) => ({
                type: m.type,
                content: m.content,
                score: cosineSimilarity(queryEmbedding, m.embedding),
              }))
              .sort((a, b) => b.score - a.score)
              .slice(0, 5)
              .filter((m) => m.score > 0.3);
          }
          addToolResult({ tool: toolName, toolCallId, output });
        } catch {
          addToolResult({ tool: toolName, toolCallId, output: "Failed to fetch." });
        }
        return;
      }

      const mutationType = toolName as PendingActionType;

      let referenceError: string | null;
      try {
        referenceError = await withTimeout(validateReference(toolName, toolInput), 15000);
      } catch {
        referenceError = "Timed out looking up existing records — please try again.";
      }
      if (referenceError) {
        addToolResult({ tool: toolName, toolCallId, output: `Error: ${referenceError}` });
        return;
      }

      // saveMemory needs an embedding computed up front so it can be
      // included whether the action executes immediately or gets queued.
      let mutationPayload = toolInput;
      if (mutationType === "saveMemory") {
        const { content } = toolInput as { content: string };
        const embedding = await embedText(content);
        mutationPayload = { ...toolInput, embedding };
      }

      if (aiMode === "execute") {
        try {
          await withTimeout(
            (async () => {
              if (mutationType === "createProject") {
                await createProject(mutationPayload as { name: string; description: string });
              } else if (mutationType === "createTask") {
                await createTask(mutationPayload as { title: string; projectId: string | null });
              } else if (mutationType === "createReminder") {
                const { text, dueAt } = mutationPayload as { text: string; dueAt: string };
                await createReminder({ text, dueAt: new Date(dueAt) });
              } else if (mutationType === "completeTask") {
                const { taskId, projectId } = mutationPayload as {
                  taskId: string;
                  projectId: string | null;
                };
                await updateTaskStatus(projectId, taskId, "done");
              } else if (mutationType === "completeReminder") {
                const { reminderId } = mutationPayload as { reminderId: string };
                await markReminderDone(reminderId);
              } else if (mutationType === "saveMemory") {
                const { type, content, embedding } = mutationPayload as {
                  type: MemoryType;
                  content: string;
                  embedding: number[];
                };
                await createMemory({ type, content, embedding, source: "ai" });
              } else if (mutationType === "saveDecision") {
                const { projectId, question, options, recommended, reasoning, confidence } =
                  mutationPayload as {
                    projectId: string;
                    question: string;
                    options: DecisionOption[];
                    recommended: string;
                    reasoning: string;
                    confidence: number;
                  };
                await createDecision(projectId, {
                  question,
                  options,
                  recommended,
                  reasoning,
                  confidence,
                });
              } else if (mutationType === "saveResearch") {
                const { projectId, title, content, links, tags } = mutationPayload as {
                  projectId: string;
                  title: string;
                  content: string;
                  links?: string[];
                  tags?: string[];
                };
                await createResearchEntry(projectId, { title, content, links, tags });
              }
            })(),
            15000
          );
          addToolResult({ tool: toolName, toolCallId, output: "Done — applied directly." });
        } catch {
          addToolResult({ tool: toolName, toolCallId, output: "Failed to apply." });
        }
      } else {
        await queuePendingAction(
          mutationType,
          summarizeAction(toolName, toolInput),
          mutationPayload
        );
        addToolResult({
          tool: toolName,
          toolCallId,
          output: "Queued for your approval — see Pending Actions.",
        });
      }
    },
  });

  useEffect(() => {
    if (initialText && !autoSentRef.current) {
      autoSentRef.current = true;
      sendMessage({ text: initialText });
      router.replace(conversationIdRef.current ? `/chat?id=${conversationIdRef.current}` : "/chat", {
        scroll: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  const isBusy = status === "submitted" || status === "streaming";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isBusy) return;
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Chat</span>
        <Link
          href="/settings"
          className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          Mode: {aiMode === "execute" ? "Auto-execute" : "Ask before acting"}
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message || "Something went wrong."}
        </div>
      )}

      {pendingActions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
            Pending Actions
          </h2>
          {pendingActions.map((action) => (
            <div
              key={action.id}
              className="glow-border flex items-center justify-between rounded-md border bg-card/60 px-3 py-2"
            >
              <span className="text-sm">{action.summary}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => void approvePendingAction(action)}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void rejectPendingAction(action.id)}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ScrollArea className="glow-border flex-1 rounded-lg border bg-card/50 p-4">
        <div className="flex flex-col gap-4">
          {messages.length === 0 && (
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Awaiting input — AI Gateway link ready.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex max-w-2xl flex-col gap-1",
                message.role === "user" ? "self-end items-end" : "self-start items-start"
              )}
            >
              <span className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
                {message.role === "user" ? "You" : "Assistant"}
              </span>
              <div
                className={cn(
                  "rounded-lg px-4 py-2",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground text-sm"
                    : "glow-border border bg-muted/60 text-foreground"
                )}
              >
                {message.parts.map((part, i) => {
                  if (part.type === "text") {
                    return message.role === "user" ? (
                      <span key={i}>{part.text}</span>
                    ) : (
                      <Markdown key={i} text={part.text} />
                    );
                  }
                  if (part.type.startsWith("tool-")) {
                    return (
                      <div
                        key={i}
                        className="mb-1 font-mono text-[0.65rem] uppercase tracking-widest text-primary"
                      >
                        → {part.type.replace("tool-", "")}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder="Message..."
          className="min-h-[44px] resize-none"
          rows={1}
        />
        <Button type="submit" disabled={isBusy || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
