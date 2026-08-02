"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, ChevronDown, Hourglass, Sparkles } from "lucide-react";
import { useCollection } from "@/hooks/use-collection";
import { briefingsQuery } from "@/lib/firestore/briefings";
import { projectsQuery } from "@/lib/firestore/projects";
import { allTasksQuery } from "@/lib/firestore/tasks";
import { remindersQuery } from "@/lib/firestore/reminders";
import { peopleQuery } from "@/lib/firestore/people";
import { inboxQuery } from "@/lib/firestore/inbox";
import { buildSuggestions, type Suggestion } from "@/lib/insights/suggestions";
import { Markdown } from "@/components/chat/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The Briefing as an executive dashboard: instead of replaying stored text, it
 * answers "what needs my attention right now?" live from the workspace — and
 * because everything arrives through Firestore listeners, it is always
 * current without a refresh. The AI-written daily/weekly summaries remain
 * below as narrative colour; the sections above are computed facts.
 */

const SEVERITY_STYLE: Record<Suggestion["severity"], string> = {
  urgent: "border-l-2 border-l-[oklch(0.68_0.21_25)]",
  attention: "border-l-2 border-l-[oklch(0.83_0.16_85)]",
  info: "border-l-2 border-l-[oklch(0.74_0.16_245)]",
};

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {title}
      </h2>
      {children}
    </div>
  );
}

function Row({ href, children, accent }: { href: string; children: React.ReactNode; accent?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "surface tap flex items-center gap-3 px-4 py-3 text-sm hover:bg-card",
        accent
      )}
    >
      {children}
    </Link>
  );
}

export default function BriefingPage() {
  const { data: briefings, loading } = useCollection(useMemo(() => briefingsQuery(), []));
  const { data: projects } = useCollection(useMemo(() => projectsQuery(), []));
  const { data: tasks } = useCollection(useMemo(() => allTasksQuery(), []));
  const { data: reminders } = useCollection(useMemo(() => remindersQuery(), []));
  const { data: people } = useCollection(useMemo(() => peopleQuery(), []));
  const { data: inbox } = useCollection(useMemo(() => inboxQuery(), []));

  const [historyOpen, setHistoryOpen] = useState(false);

  const now = new Date();
  const openTasks = tasks.filter((t) => t.status !== "done");
  const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate.toMillis() < now.getTime());
  const urgentTasks = openTasks.filter(
    (t) => t.priority === "high" && !overdueTasks.includes(t)
  );
  const blockedTasks = openTasks.filter((t) => t.status === "blocked");
  const pendingReminders = reminders.filter((r) => r.status === "pending");
  const overdueReminders = pendingReminders.filter((r) => r.dueAt.toMillis() < now.getTime());
  const todayReminders = pendingReminders
    .filter((r) => isToday(r.dueAt.toDate()) && !overdueReminders.includes(r))
    .sort((a, b) => a.dueAt.toMillis() - b.dueAt.toMillis());

  const suggestions = useMemo(
    () => buildSuggestions({ projects, tasks, reminders, people, inbox, now: new Date() }),
    [projects, tasks, reminders, people, inbox]
  );

  const latestDaily = briefings.find((b) => b.type === "daily");
  const latestWeekly = briefings.find((b) => b.type === "weekly");
  const nothingUrgent =
    overdueTasks.length + overdueReminders.length + urgentTasks.length + blockedTasks.length === 0;

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
          {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} — what
          needs your attention.
        </p>
      </div>

      <Section title="Urgent" icon={AlertTriangle}>
        {nothingUrgent ? (
          <p className="text-sm text-muted-foreground">Nothing is on fire. Clear runway.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {overdueReminders.map((r) => (
              <Row key={r.id} href="/reminders" accent={SEVERITY_STYLE.urgent}>
                <span className="min-w-0 flex-1 truncate">{r.text}</span>
                <span className="shrink-0 font-mono text-[0.65rem] text-destructive">overdue</span>
              </Row>
            ))}
            {overdueTasks.map((t) => (
              <Row
                key={t.id}
                href={t.projectId ? `/projects/${t.projectId}` : "/tasks"}
                accent={SEVERITY_STYLE.urgent}
              >
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="shrink-0 font-mono text-[0.65rem] text-destructive">overdue</span>
              </Row>
            ))}
            {urgentTasks.map((t) => (
              <Row
                key={t.id}
                href={t.projectId ? `/projects/${t.projectId}` : "/tasks"}
                accent={SEVERITY_STYLE.urgent}
              >
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">high</span>
              </Row>
            ))}
            {blockedTasks.map((t) => (
              <Row
                key={t.id}
                href={t.projectId ? `/projects/${t.projectId}` : "/tasks"}
                accent={SEVERITY_STYLE.attention}
              >
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">blocked</span>
              </Row>
            ))}
          </div>
        )}
      </Section>

      <Section title="Today" icon={CalendarClock}>
        {todayReminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled for the rest of today.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {todayReminders.map((r) => (
              <Row key={r.id} href="/reminders">
                <span className="shrink-0 font-mono text-xs text-primary">
                  {r.dueAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.text}</span>
              </Row>
            ))}
          </div>
        )}
      </Section>

      <Section title="Suggestions" icon={Sparkles}>
        {suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No advice today — the workspace is moving.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {suggestions.slice(0, 8).map((s) => (
              <Row key={s.id} href={s.href} accent={SEVERITY_STYLE[s.severity]}>
                <span className="min-w-0 flex-1">{s.text}</span>
              </Row>
            ))}
          </div>
        )}
      </Section>

      {(latestDaily || latestWeekly) && (
        <Section title="AI summaries" icon={Hourglass}>
          <div className="flex flex-col gap-2">
            {latestDaily && (
              <div className="surface flex flex-col gap-2 px-4 py-3">
                <span className="font-mono text-[0.6rem] text-muted-foreground">
                  Daily · {latestDaily.createdAt.toDate().toLocaleString()}
                </span>
                <Markdown text={latestDaily.content} />
              </div>
            )}
            {latestWeekly && (
              <div className="surface flex flex-col gap-2 px-4 py-3">
                <span className="font-mono text-[0.6rem] text-muted-foreground">
                  Weekly · {latestWeekly.createdAt.toDate().toLocaleString()}
                </span>
                <Markdown text={latestWeekly.content} />
              </div>
            )}
          </div>
        </Section>
      )}

      {briefings.length > 2 && (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="tap flex items-center gap-2 self-start font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", historyOpen && "rotate-180")} />
            History
          </button>
          {historyOpen && (
            <div className="flex flex-col gap-2">
              {briefings
                .filter((b) => b.id !== latestDaily?.id && b.id !== latestWeekly?.id)
                .map((b) => (
                  <div key={b.id} className="flex flex-col gap-1 rounded-md border border-border/40 px-4 py-3">
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
          )}
        </div>
      )}
    </div>
  );
}
