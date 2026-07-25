"use client";

import { useMemo } from "react";
import { useCollection } from "@/hooks/use-collection";
import { allTasksQuery } from "@/lib/firestore/tasks";
import { projectsQuery } from "@/lib/firestore/projects";
import { remindersQuery } from "@/lib/firestore/reminders";
import { computeAnalytics } from "@/lib/analytics/metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

const STATUS_LABEL: Record<Task["status"], string> = {
  todo: "To do",
  doing: "Doing",
  blocked: "Blocked",
  done: "Done",
};

const STATUS_COLOR: Record<Task["status"], string> = {
  todo: "var(--chart-2)",
  doing: "var(--chart-1)",
  blocked: "var(--chart-5)",
  done: "var(--chart-3)",
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="glow-border border bg-card/60 backdrop-blur-sm">
      <CardContent className="py-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { data: tasks, loading: loadingTasks } = useCollection(useMemo(() => allTasksQuery(), []));
  const { data: projects, loading: loadingProjects } = useCollection(useMemo(() => projectsQuery(), []));
  const { data: reminders, loading: loadingReminders } = useCollection(useMemo(() => remindersQuery(), []));

  const loading = loadingTasks || loadingProjects || loadingReminders;
  const metrics = useMemo(() => computeAnalytics(tasks, projects, reminders), [tasks, projects, reminders]);

  if (loading) {
    return <Skeleton className="h-[600px] w-full" />;
  }

  const maxDaily = Math.max(1, ...metrics.dailyCompletions.map((d) => d.count));
  const totalTasks = metrics.statusBreakdown.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          How work is actually moving — derived from your own tasks, projects, and reminders.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Completed this week" value={String(metrics.completedThisWeek)} />
        <StatTile label="Open tasks" value={String(metrics.openTasks)} />
        <StatTile label="Active projects" value={String(metrics.activeProjects)} />
        <StatTile
          label="Avg days to close"
          value={metrics.avgDaysToClose === null ? "—" : metrics.avgDaysToClose.toFixed(1)}
        />
      </div>

      <Card className="glow-border border bg-card/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-base">Tasks completed — last 14 days</CardTitle>
        </CardHeader>
        <CardContent>
          {maxDaily === 1 && metrics.dailyCompletions.every((d) => d.count === 0) ? (
            <p className="text-sm text-muted-foreground">No completed tasks in this window yet.</p>
          ) : (
            <div className="flex h-32 items-end gap-1.5">
              {metrics.dailyCompletions.map((d) => (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-sm bg-primary/70 transition-all"
                    style={{ height: `${Math.max(4, (d.count / maxDaily) * 100)}%` }}
                    title={`${d.date}: ${d.count}`}
                  />
                  <span className="font-mono text-[0.55rem] text-muted-foreground">
                    {d.date.split(" ")[0]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glow-border border bg-card/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-base">Task status breakdown</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {totalTasks === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet.</p>
            ) : (
              <>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                  {metrics.statusBreakdown.map((s) => (
                    <div
                      key={s.status}
                      style={{
                        width: `${(s.count / totalTasks) * 100}%`,
                        backgroundColor: STATUS_COLOR[s.status],
                      }}
                    />
                  ))}
                </div>
                <div className="flex flex-col gap-1.5">
                  {metrics.statusBreakdown.map((s) => (
                    <div key={s.status} className="flex items-center gap-2 text-sm">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: STATUS_COLOR[s.status] }}
                      />
                      <span className="flex-1 text-muted-foreground">{STATUS_LABEL[s.status]}</span>
                      <span className="font-mono">{s.count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="glow-border border bg-card/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-base">Project progress</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {metrics.projectProgress.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active projects.</p>
            ) : (
              metrics.projectProgress.map((p) => (
                <div key={p.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">{p.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{p.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full bg-primary")}
                      style={{ width: `${p.progress}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
