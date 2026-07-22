"use client";

import { useMemo } from "react";
import { useCollection } from "@/hooks/use-collection";
import { briefingsQuery } from "@/lib/firestore/briefings";
import { Markdown } from "@/components/chat/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function BriefingPage() {
  const { data: briefings, loading } = useCollection(useMemo(() => briefingsQuery(), []));

  const daily = briefings.filter((b) => b.type === "daily");
  const weekly = briefings.filter((b) => b.type === "weekly");
  const latestDaily = daily[0];
  const latestWeekly = weekly[0];

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Briefing</h1>
        <p className="text-sm text-muted-foreground">
          Auto-generated daily briefings (7am ET) and weekly reviews (Monday 8am ET).
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          Today
        </h2>
        {latestDaily ? (
          <div className="glow-border flex flex-col gap-2 rounded-md border bg-card/40 px-4 py-3">
            <span className="font-mono text-[0.6rem] text-muted-foreground">
              {latestDaily.createdAt.toDate().toLocaleString()}
            </span>
            <Markdown text={latestDaily.content} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No daily briefing yet — the first one runs at 7am ET.</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          This Week
        </h2>
        {latestWeekly ? (
          <div className="glow-border flex flex-col gap-2 rounded-md border bg-card/40 px-4 py-3">
            <span className="font-mono text-[0.6rem] text-muted-foreground">
              {latestWeekly.createdAt.toDate().toLocaleString()}
            </span>
            <Markdown text={latestWeekly.content} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No weekly review yet — the first one runs Monday at 8am ET.
          </p>
        )}
      </div>

      {(daily.length > 1 || weekly.length > 1) && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
            History
          </h2>
          <div className="flex flex-col gap-2">
            {briefings
              .filter((b) => b.id !== latestDaily?.id && b.id !== latestWeekly?.id)
              .map((b) => (
              <div
                key={b.id}
                className="flex flex-col gap-1 rounded-md border border-border/40 px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[0.6rem] uppercase">
                    {b.type}
                  </Badge>
                  <span className="font-mono text-[0.6rem] text-muted-foreground">
                    {b.createdAt.toDate().toLocaleString()}
                  </span>
                </div>
                <Markdown text={b.content} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
