"use client";

import { useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { auth } from "@/lib/firebase/client";

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
      <ScrollArea className="flex-1 rounded-lg border border-border p-4">
        <div className="flex flex-col gap-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Send a message to test the AI Gateway connection.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-2xl rounded-lg px-4 py-2 text-sm",
                message.role === "user"
                  ? "self-end bg-primary text-primary-foreground"
                  : "self-start bg-muted text-foreground"
              )}
            >
              {message.parts.map((part, i) =>
                part.type === "text" ? <span key={i}>{part.text}</span> : null
              )}
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
