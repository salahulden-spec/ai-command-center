"use client";

import { useMemo, useState } from "react";
import { X, Check } from "lucide-react";
import { useCollection } from "@/hooks/use-collection";
import { inboxQuery, createInboxItem, markInboxItemOrganized, deleteInboxItem } from "@/lib/firestore/inbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

export default function InboxPage() {
  const { data: items, loading } = useCollection(useMemo(() => inboxQuery(), []));
  const [content, setContent] = useState("");

  const handleCapture = async () => {
    if (!content.trim()) return;
    await createInboxItem(content.trim());
    setContent("");
  };

  const unprocessed = items.filter((i) => i.status === "unprocessed");
  const organized = items.filter((i) => i.status === "organized");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Inbox</h1>
        <p className="text-sm text-muted-foreground">Capture first, organize later.</p>
      </div>

      <div className="flex gap-2">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleCapture();
            }
          }}
          placeholder="Drop an idea, note, or link..."
          className="min-h-[44px] resize-none"
          rows={1}
        />
        <Button onClick={() => void handleCapture()} disabled={!content.trim()}>
          Capture
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
              Unprocessed ({unprocessed.length})
            </h2>
            {unprocessed.length === 0 && (
              <p className="text-sm text-muted-foreground">Inbox zero.</p>
            )}
            {unprocessed.map((item) => (
              <div
                key={item.id}
                className="glow-border flex items-center justify-between rounded-md border bg-card/40 px-3 py-2"
              >
                <span className="text-sm">{item.content}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void markInboxItemOrganized(item.id)}
                    className="text-muted-foreground hover:text-primary"
                    aria-label="Mark organized"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => void deleteInboxItem(item.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {organized.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
                Organized ({organized.length})
              </h2>
              {organized.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2 text-muted-foreground"
                >
                  <span className="text-sm line-through">{item.content}</span>
                  <button
                    onClick={() => void deleteInboxItem(item.id)}
                    className="hover:text-destructive"
                    aria-label="Delete"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
