"use client";

import { useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { auth } from "@/lib/firebase/client";
import { Markdown } from "@/components/chat/markdown";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { userSettingsRef, setAiMode } from "@/lib/firestore/user-settings";
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
import type { AiMode, PendingActionType } from "@/types";

const READ_TOOLS = new Set(["listProjects", "listOpenTasks", "listPendingReminders"]);

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
    default:
      return toolName;
  }
}

export default function ChatPage() {
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [aiMode, setLocalAiMode] = useState<AiMode>("ask");

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

  const { messages, sendMessage, status, addToolResult } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
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
          }
          addToolResult({ tool: toolName, toolCallId, output });
        } catch {
          addToolResult({ tool: toolName, toolCallId, output: "Failed to fetch." });
        }
        return;
      }

      const mutationType = toolName as PendingActionType;

      if (aiMode === "execute") {
        try {
          if (mutationType === "createProject") {
            await createProject(toolInput as { name: string; description: string });
          } else if (mutationType === "createTask") {
            await createTask(toolInput as { title: string; projectId: string | null });
          } else if (mutationType === "createReminder") {
            const { text, dueAt } = toolInput as { text: string; dueAt: string };
            await createReminder({ text, dueAt: new Date(dueAt) });
          } else if (mutationType === "completeTask") {
            const { taskId, projectId } = toolInput as {
              taskId: string;
              projectId: string | null;
            };
            await updateTaskStatus(projectId, taskId, "done");
          } else if (mutationType === "completeReminder") {
            const { reminderId } = toolInput as { reminderId: string };
            await markReminderDone(reminderId);
          }
          addToolResult({ tool: toolName, toolCallId, output: "Done — applied directly." });
        } catch {
          addToolResult({ tool: toolName, toolCallId, output: "Failed to apply." });
        }
      } else {
        await queuePendingAction(mutationType, summarizeAction(toolName, toolInput), toolInput);
        addToolResult({
          tool: toolName,
          toolCallId,
          output: "Queued for your approval — see Pending Actions.",
        });
      }
    },
  });

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
        <Select
          value={aiMode}
          onValueChange={(mode) => user && void setAiMode(user.uid, mode as AiMode)}
        >
          <SelectTrigger className="w-44 font-mono text-xs uppercase">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ask">Ask before acting</SelectItem>
            <SelectItem value="execute">Auto-execute</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
