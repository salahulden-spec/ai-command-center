import type { InboxItem, Person, Project, Reminder, Task } from "@/types";

/**
 * The proactive layer: deterministic rules over the live workspace that answer
 * "what needs my attention?" without being asked.
 *
 * Deliberately not an AI call. These run on every snapshot on every visit to
 * Home and Briefing, so they must be free, instant, and identical for the same
 * data — a model would be slow, cost money, and phrase the same warning three
 * different ways on three renders. The AI's job is capturing structure; once
 * the structure exists, finding an overdue task is arithmetic.
 */

export type SuggestionSeverity = "urgent" | "attention" | "info";

export interface Suggestion {
  id: string;
  severity: SuggestionSeverity;
  text: string;
  href: string;
}

export interface SuggestionsInput {
  projects: Project[];
  tasks: Task[];
  reminders: Reminder[];
  people: Person[];
  inbox: InboxItem[];
  now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(then: number, now: number): number {
  return Math.floor((now - then) / DAY_MS);
}

export function buildSuggestions(input: SuggestionsInput): Suggestion[] {
  const now = input.now.getTime();
  const out: Suggestion[] = [];
  const openTasks = input.tasks.filter((t) => t.status !== "done");

  for (const task of openTasks) {
    if (task.dueDate && task.dueDate.toMillis() < now) {
      out.push({
        id: `overdue-task-${task.id}`,
        severity: "urgent",
        text: `"${task.title}" is ${daysBetween(task.dueDate.toMillis(), now) || 1} day(s) overdue.`,
        href: task.projectId ? `/projects/${task.projectId}` : "/tasks",
      });
    }
  }

  for (const reminder of input.reminders) {
    if (reminder.status === "pending" && reminder.dueAt.toMillis() < now) {
      out.push({
        id: `overdue-reminder-${reminder.id}`,
        severity: "urgent",
        text: `Reminder slipped: "${reminder.text}".`,
        href: "/reminders",
      });
    }
  }

  const blocked = openTasks.filter((t) => t.status === "blocked");
  if (blocked.length) {
    out.push({
      id: "blocked-tasks",
      severity: "attention",
      text: `${blocked.length} task(s) are blocked and going nowhere on their own.`,
      href: "/tasks",
    });
  }

  for (const project of input.projects) {
    if (project.status !== "active") continue;
    const projectTasks = openTasks.filter((t) => t.projectId === project.id);
    if (projectTasks.length === 0) {
      out.push({
        id: `no-next-step-${project.id}`,
        severity: "attention",
        text: `"${project.name}" has no open tasks — no defined next step.`,
        href: `/projects/${project.id}`,
      });
    }
    const idleDays = daysBetween(project.updatedAt.toMillis(), now);
    if (idleDays >= 7) {
      out.push({
        id: `stale-project-${project.id}`,
        severity: "attention",
        text: `"${project.name}" has had no activity for ${idleDays} days.`,
        href: `/projects/${project.id}`,
      });
    }
  }

  const staleInbox = input.inbox.filter(
    (i) => i.status === "unprocessed" && daysBetween(i.createdAt.toMillis(), now) >= 3
  );
  if (staleInbox.length) {
    out.push({
      id: "stale-inbox",
      severity: "info",
      text: `${staleInbox.length} inbox item(s) have sat unprocessed for 3+ days.`,
      href: "/inbox",
    });
  }

  // High-priority work that has sat untouched: urgency claimed but not acted on.
  for (const task of openTasks) {
    if (task.priority !== "high" || (task.dueDate && task.dueDate.toMillis() < now)) continue;
    const referenceMs = (task.updatedAt ?? task.createdAt).toMillis();
    const idleDays = daysBetween(referenceMs, now);
    if (idleDays >= 4) {
      out.push({
        id: `idle-priority-${task.id}`,
        severity: "attention",
        text: `High-priority "${task.title}" hasn't moved in ${idleDays} days.`,
        href: task.projectId ? `/projects/${task.projectId}` : "/tasks",
      });
    }
  }

  const rank: Record<SuggestionSeverity, number> = { urgent: 0, attention: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
