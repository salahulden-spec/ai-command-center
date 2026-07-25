import type { Project, Task, Reminder } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

export interface DailyCount {
  date: string; // "Mon 7/21"
  count: number;
}

export interface AnalyticsSummary {
  completedThisWeek: number;
  openTasks: number;
  activeProjects: number;
  avgDaysToClose: number | null;
  statusBreakdown: { status: Task["status"]; count: number }[];
  dailyCompletions: DailyCount[];
  projectProgress: { id: string; name: string; progress: number }[];
  pendingReminders: number;
}

export function computeAnalytics(
  tasks: Task[],
  projects: Project[],
  reminders: Reminder[]
): AnalyticsSummary {
  const weekAgo = daysAgo(7);
  const doneTasks = tasks.filter((t) => t.status === "done");

  const completedThisWeek = doneTasks.filter(
    (t) => t.updatedAt && t.updatedAt.toDate() > weekAgo
  ).length;

  const closeDurations = doneTasks
    .filter((t) => t.updatedAt)
    .map((t) => (t.updatedAt!.toDate().getTime() - t.createdAt.toDate().getTime()) / DAY_MS)
    .filter((days) => days >= 0);
  const avgDaysToClose =
    closeDurations.length > 0
      ? closeDurations.reduce((sum, d) => sum + d, 0) / closeDurations.length
      : null;

  const statuses: Task["status"][] = ["todo", "doing", "blocked", "done"];
  const statusBreakdown = statuses.map((status) => ({
    status,
    count: tasks.filter((t) => t.status === status).length,
  }));

  const dailyCompletions: DailyCount[] = Array.from({ length: 14 }, (_, i) => {
    const day = daysAgo(13 - i);
    const label = day.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
    const count = doneTasks.filter((t) => {
      if (!t.updatedAt) return false;
      const d = t.updatedAt.toDate();
      return d.toDateString() === day.toDateString();
    }).length;
    return { date: label, count };
  });

  const projectProgress = projects
    .filter((p) => p.status === "active")
    .map((p) => ({ id: p.id, name: p.name, progress: p.progress ?? 0 }));

  return {
    completedThisWeek,
    openTasks: tasks.filter((t) => t.status !== "done").length,
    activeProjects: projects.filter((p) => p.status === "active").length,
    avgDaysToClose,
    statusBreakdown,
    dailyCompletions,
    projectProgress,
    pendingReminders: reminders.filter((r) => r.status === "pending").length,
  };
}
