"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useCollection } from "@/hooks/use-collection";
import { memoryQuery, createMemory, deleteMemory } from "@/lib/firestore/memory";
import { embedText } from "@/lib/ai/embed-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MemoryType } from "@/types";

const MEMORY_TYPES: MemoryType[] = ["fact", "preference", "person", "company", "decision"];

export default function KnowledgePage() {
  const { data: memories, loading } = useCollection(useMemo(() => memoryQuery(), []));
  const [type, setType] = useState<MemoryType>("fact");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const embedding = await embedText(content.trim());
      await createMemory({ type, content: content.trim(), embedding, source: "manual" });
      setContent("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Knowledge</h1>
        <p className="text-sm text-muted-foreground">
          Long-term memory — durable facts, preferences, and decisions the AI can recall on request.
        </p>
      </div>

      <div className="flex gap-2">
        <Select value={type} onValueChange={(v) => setType(v as MemoryType)}>
          <SelectTrigger className="w-36 font-mono text-xs uppercase">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEMORY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Something worth remembering long-term..."
          className="min-h-[44px] resize-none"
          rows={1}
        />
        <Button onClick={() => void handleSave()} disabled={!content.trim() || saving}>
          Save
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : memories.length === 0 ? (
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Nothing remembered yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {memories.map((memory) => (
            <div
              key={memory.id}
              className="glow-border flex items-center justify-between gap-4 rounded-md border bg-card/40 px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
                  {memory.type}
                </Badge>
                <span className="text-sm">{memory.content}</span>
              </div>
              <button
                onClick={() => void deleteMemory(memory.id)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete memory"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
