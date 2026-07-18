"use client";

import { useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { auth } from "@/lib/firebase/client";
import { Markdown } from "@/components/chat/markdown";

export default function ChatPage() {
  const [input, setInput] = useState("");
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
  const { messages, sendMessage, status } = useChat({ transport });

  const isBusy = status === "submitted" || status === "streaming";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isBusy) return;
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col gap-4">
      <ScrollArea className="glow-border flex-1 rounded-lg border bg-card/40 p-4 backdrop-blur-sm">
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
                {message.parts.map((part, i) =>
                  part.type === "text" ? (
                    message.role === "user" ? (
                      <span key={i}>{part.text}</span>
                    ) : (
                      <Markdown key={i} text={part.text} />
                    )
                  ) : null
                )}
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
