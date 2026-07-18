"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { projectsQuery } from "@/lib/firestore/projects";
import { allTasksQuery } from "@/lib/firestore/tasks";
import { inboxQuery } from "@/lib/firestore/inbox";
import { remindersQuery } from "@/lib/firestore/reminders";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function StatCard({ href, label, value, hint }: { href: string; label: string; value: number; hint: string }) {
  return (
    <Link href={href}>
      <Card className="glow-border h-full border bg-card/60 backdrop-blur-sm transition-colors hover:bg-card/90">
        <CardHeader>
          <CardDescription className="font-mono text-[0.65rem] uppercase tracking-widest">
            {label}
          </CardDescription>
          <CardTitle className="glow-text text-3xl">{value}</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: projects } = useCollection(projectsQuery());
  const { data: tasks } = useCollection(allTasksQuery());
  const { data: inbox } = useCollection(inboxQuery());
  const { data: reminders } = useCollection(remindersQuery());

  const activeProjects = projects.filter((p) => p.status === "active");
  const openTasks = tasks.filter((t) => t.status !== "done");
  const unprocessedInbox = inbox.filter((i) => i.status === "unprocessed");
  const upcomingReminders = reminders
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.dueAt.toMillis() - b.dueAt.toMillis());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
          Session active — {user?.email}
        </div>
        <h1 className="mt-1 text-xl font-semibold">Today&apos;s Command Center</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          href="/projects"
          label="Active projects"
          value={activeProjects.length}
          hint={`${projects.length} total`}
        />
        <StatCard
          href="/projects"
          label="Open tasks"
          value={openTasks.length}
          hint={`${tasks.length} total`}
        />
        <StatCard
          href="/inbox"
          label="Unprocessed inbox"
          value={unprocessedInbox.length}
          hint={`${inbox.length} total`}
        />
        <StatCard
          href="/reminders"
          label="Pending reminders"
          value={upcomingReminders.length}
          hint="tap to view"
        />
      </div>

      {upcomingReminders.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Next up
          </h2>
          <div className="flex flex-col gap-2">
            {upcomingReminders.slice(0, 5).map((reminder) => (
              <div
                key={reminder.id}
                className="glow-border flex items-center justify-between rounded-md border bg-card/40 px-3 py-2"
              >
                <span className="text-sm">{reminder.text}</span>
                <span className="font-mono text-[0.65rem] text-muted-foreground">
                  {reminder.dueAt.toDate().toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
