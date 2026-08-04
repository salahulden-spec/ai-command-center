import type { Memory, Person, Project, Reminder, Task } from "@/types";
import type { Entity, Universe } from "./universe";

/**
 * What the Mind View says about the record you are looking at.
 *
 * Deliberately arithmetic, not a model call. Every line here is something the
 * workspace already knows and can be checked against — a task is overdue, a
 * project's progress bar disagrees with its own task list, a contact is
 * attached to nothing. Phrasing it as a prediction would be dressing up a
 * subtraction, so `weight` is described in the UI as signal strength rather
 * than confidence: it ranks the observations, it does not claim certainty.
 */

export interface Advice {
  id: string;
  text: string;
  /** 0..1 — how loudly this is shouting, used only for ordering and the bar. */
  weight: number;
  /** Where to go if the observation points at another record. */
  go?: string;
}

export interface AdviceInput {
  projects: Project[];
  tasks: Task[];
  people: Person[];
  reminders: Reminder[];
  memories: Memory[];
  now: Date;
}

const DAY_MS = 86_400_000;

function daysSince(ts: { toMillis(): number } | null | undefined, now: Date): number | null {
  if (!ts) return null;
  return Math.floor((now.getTime() - ts.toMillis()) / DAY_MS);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Entity ids are `kind:recordId`; a record id may itself contain colons. */
function recordIdOf(entityId: string): string {
  const i = entityId.indexOf(":");
  return i === -1 ? entityId : entityId.slice(i + 1);
}

export function adviceFor(universe: Universe, entity: Entity, input: AdviceInput): Advice[] {
  const out: Advice[] = [];
  const { now } = input;
  const recordId = recordIdOf(entity.id);
  const neighbours = [...(universe.edges.get(entity.id) ?? [])]
    .map((id) => universe.byId.get(id))
    .filter((e): e is Entity => !!e);

  if (entity.kind === "owner") {
    const urgent = neighbours.filter((e) => e.urgent);
    if (urgent.length) {
      out.push({
        id: "owner-urgent",
        text: `${plural(urgent.length, "thing")} here ${urgent.length === 1 ? "is" : "are"} overdue or high priority.`,
        weight: Math.min(1, 0.6 + urgent.length * 0.1),
        go: urgent[0].id,
      });
    }
    const stalled = input.projects.filter(
      (p) =>
        p.status === "active" &&
        !input.tasks.some((t) => t.projectId === p.id && t.status !== "done")
    );
    if (stalled.length) {
      out.push({
        id: "owner-stalled",
        text: `${plural(stalled.length, "active project")} ${stalled.length === 1 ? "has" : "have"} nothing open — no next step recorded.`,
        weight: 0.62,
        go: `project:${stalled[0].id}`,
      });
    }
    const loose = input.people.filter((p) => (universe.edges.get(`person:${p.id}`)?.size ?? 0) <= 1);
    if (loose.length) {
      out.push({
        id: "owner-loose-people",
        text: `${plural(loose.length, "contact")} ${loose.length === 1 ? "is" : "are"} not attached to any work.`,
        weight: 0.34,
        go: `person:${loose[0].id}`,
      });
    }
  }

  if (entity.kind === "project") {
    const project = input.projects.find((p) => p.id === recordId);
    const tasks = input.tasks.filter((t) => t.projectId === recordId);
    const done = tasks.filter((t) => t.status === "done").length;
    const open = tasks.length - done;

    if (project && tasks.length) {
      const impliedPct = Math.round((done / tasks.length) * 100);
      const gap = impliedPct - (project.progress ?? 0);
      if (Math.abs(gap) >= 20) {
        out.push({
          id: "project-progress-gap",
          text: `${done} of ${tasks.length} tasks closed, but progress reads ${project.progress ?? 0}%. The tasks say ${impliedPct}%.`,
          // Capped below the blocked-task weight: a stale progress bar is
          // bookkeeping, a blocker is the thing stopping the work.
          weight: Math.min(0.8, 0.45 + Math.abs(gap) / 100),
        });
      }
    }

    const blocked = tasks.find((t) => t.status === "blocked");
    if (blocked) {
      out.push({
        id: "project-blocked",
        text: `“${blocked.title}” is blocked. Nothing under this moves until it does.`,
        weight: 0.88,
        go: `task:${blocked.id}`,
      });
    }

    if (project && !open && tasks.length) {
      out.push({
        id: "project-no-next",
        text: "Every task here is closed. Either this is finished or the next step is unrecorded.",
        weight: 0.7,
      });
    }
    if (!tasks.length) {
      out.push({
        id: "project-empty",
        text: "No tasks recorded against this yet.",
        weight: 0.6,
      });
    }

    const idle = project ? daysSince(project.updatedAt, now) : null;
    if (idle !== null && idle >= 14 && project?.status === "active") {
      out.push({
        id: "project-idle",
        text: `Active but untouched for ${plural(idle, "day")}.`,
        weight: Math.min(0.9, 0.5 + idle / 60),
      });
    }

    if (!neighbours.some((e) => e.kind === "person")) {
      out.push({ id: "project-unowned", text: "Nobody is attached to this.", weight: 0.4 });
    }
  }

  if (entity.kind === "task") {
    const task = input.tasks.find((t) => t.id === recordId);
    const overdueBy = task?.dueDate ? daysSince(task.dueDate, now) : null;

    if (task && task.status !== "done" && overdueBy !== null && overdueBy > 0) {
      out.push({
        id: "task-overdue",
        text: `Overdue by ${plural(overdueBy, "day")}.`,
        weight: Math.min(1, 0.7 + overdueBy / 30),
      });
    }
    if (task && task.status === "blocked" && !neighbours.some((e) => e.kind === "person")) {
      out.push({
        id: "task-blocked-unowned",
        text: "Blocked, with nobody attached to unblock it.",
        weight: 0.84,
      });
    }
    const age = task ? daysSince(task.updatedAt ?? task.createdAt, now) : null;
    if (task && task.priority === "high" && task.status === "todo" && age !== null && age >= 5) {
      out.push({
        id: "task-stale-high",
        text: `High priority, but not started in ${plural(age, "day")}.`,
        weight: Math.min(0.95, 0.55 + age / 40),
      });
    }
    if (task && !task.projectId) {
      out.push({
        id: "task-unfiled",
        text: "Standalone — not filed under any project.",
        weight: 0.3,
      });
    }
  }

  if (entity.kind === "person") {
    const openWork = neighbours.filter((e) => e.kind !== "owner" && !e.done);
    if (openWork.length) {
      out.push({
        id: "person-open",
        text: `${plural(openWork.length, "open item")} ${openWork.length === 1 ? "references" : "reference"} them.`,
        weight: Math.min(0.9, 0.45 + openWork.length * 0.1),
        go: openWork[0].id,
      });
    } else {
      out.push({
        id: "person-idle",
        text: "Not connected to any live work.",
        weight: 0.35,
      });
    }
  }

  if (entity.kind === "knowledge") {
    const age = daysSince(
      input.memories.find((m) => m.id === recordId)?.createdAt,
      now
    );
    const attached = neighbours.filter((e) => e.kind !== "owner");
    if (attached.length) {
      out.push({
        id: "knowledge-cited",
        text: `Attached to ${plural(attached.length, "record")}.`,
        weight: 0.4,
        go: attached[0].id,
      });
    } else {
      out.push({
        id: "knowledge-loose",
        text: "Filed against nothing — it will only surface if you go looking.",
        weight: 0.48,
      });
    }
    if (age !== null && age >= 30) {
      out.push({
        id: "knowledge-stale",
        text: `Recorded ${plural(age, "day")} ago and not revisited.`,
        weight: Math.min(0.7, 0.4 + age / 200),
      });
    }
  }

  if (entity.kind === "reminder") {
    const reminder = input.reminders.find((r) => r.id === recordId);
    const due = reminder ? daysSince(reminder.dueAt, now) : null;
    if (reminder && reminder.status !== "done" && due !== null) {
      out.push(
        due > 0
          ? {
              id: "reminder-overdue",
              text: `Overdue by ${plural(due, "day")}.`,
              weight: Math.min(1, 0.72 + due / 20),
            }
          : {
              id: "reminder-upcoming",
              text: due === 0 ? "Due today." : `Due in ${plural(Math.abs(due), "day")}.`,
              weight: 0.42,
            }
      );
    }
    const related = neighbours.find((e) => e.kind === "project");
    if (related) {
      out.push({
        id: "reminder-project",
        text: `Attached to ${related.label}.`,
        weight: 0.3,
        go: related.id,
      });
    }
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, 3);
}
