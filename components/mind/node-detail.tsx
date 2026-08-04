"use client";

import { useState } from "react";
import { CornerDownRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Advice } from "@/lib/mind/advice";
import type { Entity, EntityKind } from "@/lib/mind/universe";
import type {
  Memory,
  Person,
  Project,
  ProjectStatus,
  Reminder,
  Task,
  TaskPriority,
  TaskStatus,
} from "@/types";

/**
 * The inspector for the selected record — and the place work actually happens.
 *
 * A node on the map is a marker: it carries only what the renderer needs. This
 * resolves it back to its Firestore document and lets the owner change that
 * document in place — status, priority, progress, new tasks, who is involved.
 * Nothing here navigates away, because leaving the map to edit a record is what
 * made the map feel like a picture of the work rather than the work itself.
 *
 * Every handler is fire-and-forget: the page's Firestore listeners are the
 * source of truth, so a write re-renders this panel through the same path as a
 * change made on another device.
 */

export interface MindRecords {
  projects: Project[];
  tasks: Task[];
  people: Person[];
  reminders: Reminder[];
  memories: Memory[];
}

export interface MindActions {
  setTaskStatus: (task: Task, status: TaskStatus) => void;
  setTaskPriority: (task: Task, priority: TaskPriority) => void;
  setProjectStatus: (project: Project, status: ProjectStatus) => void;
  setProjectProgress: (project: Project, progress: number) => void;
  addTask: (projectId: string | null, title: string) => void;
  assignPerson: (
    targetType: "project" | "task" | "reminder",
    targetId: string,
    personId: string
  ) => void;
  completeReminder: (reminder: Reminder) => void;
}

/** Semantic colours for controls — separate from the map's per-type hues. */
const STATUS_COLOR = {
  green: "oklch(0.82 0.16 155)",
  blue: "oklch(0.74 0.16 245)",
  orange: "oklch(0.83 0.16 85)",
  red: "oklch(0.68 0.21 25)",
  neutral: "oklch(0.8 0.09 200)",
} as const;

/** Mirrors KIND_STYLE on the map, so a chip matches the node it describes. */
const KIND_COLOR: Record<EntityKind, string> = {
  owner: "oklch(0.85 0.17 195)",
  project: "oklch(0.72 0.19 285)",
  task: "oklch(0.78 0.14 215)",
  person: "oklch(0.8 0.15 160)",
  reminder: "oklch(0.83 0.16 85)",
  knowledge: "oklch(0.75 0.14 255)",
};

/** Entity ids are `kind:recordId`; a record id may itself contain colons. */
export function recordIdOf(entityId: string): string {
  const i = entityId.indexOf(":");
  return i === -1 ? entityId : entityId.slice(i + 1);
}

function formatDate(ts: { toDate(): Date } | null | undefined): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeDays(ts: { toMillis(): number } | null | undefined): string {
  if (!ts) return "";
  const days = Math.round((Date.now() - ts.toMillis()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days > 0) return `${days}d ago`;
  return `in ${Math.abs(days)}d`;
}

/** Module scope, not the render body: reading the clock during render is impure. */
function isOverdue(ts: { toMillis(): number } | null | undefined): boolean {
  return !!ts && ts.toMillis() < Date.now();
}

function taskDotColor(task: Task): string {
  if (task.status === "done") return STATUS_COLOR.green;
  if (task.dueDate && task.dueDate.toMillis() < Date.now()) return STATUS_COLOR.red;
  if (task.priority === "high") return STATUS_COLOR.red;
  if (task.status === "blocked") return STATUS_COLOR.orange;
  if (task.status === "doing") return STATUS_COLOR.blue;
  return STATUS_COLOR.neutral;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

/** The panel's core control: pick one of a short set, applied immediately. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; color?: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-secondary/50 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => !active && onChange(option.value)}
            className={cn(
              "tap min-h-8 flex-1 rounded-md px-1.5 py-1 text-[0.68rem] transition-colors",
              active ? "text-background" : "text-muted-foreground hover:text-foreground"
            )}
            style={active ? { backgroundColor: option.color ?? "var(--primary)" } : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="shrink-0 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 text-right text-xs">{children}</span>
    </div>
  );
}

function Row({
  color,
  title,
  meta,
  onClick,
}: {
  color: string;
  title: string;
  meta?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "tap flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
        onClick && "hover:bg-accent"
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {meta && (
        <span className="shrink-0 font-mono text-[0.6rem] text-muted-foreground">{meta}</span>
      )}
    </button>
  );
}

/** Assign someone to this record without leaving the map. */
function AssignPerson({
  people,
  alreadyLinked,
  onAssign,
}: {
  people: Person[];
  alreadyLinked: Set<string>;
  onAssign: (personId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const available = people.filter((p) => !alreadyLinked.has(p.id));
  if (!available.length) return null;

  return (
    <div className="mt-2">
      {open ? (
        <div className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-border/60">
          {available.map((person) => (
            <button
              key={person.id}
              onClick={() => {
                onAssign(person.id);
                setOpen(false);
              }}
              className="tap flex min-h-8 items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
              {person.company && (
                <span className="shrink-0 text-[0.6rem] text-muted-foreground">
                  {person.company}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="tap flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-primary hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" />
          Assign someone
        </button>
      )}
    </div>
  );
}

/** Create a task straight into the project you're looking at. */
function AddTask({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setTitle("");
  };
  return (
    <div className="mt-2 flex gap-1.5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Add a task…"
        className="min-h-8 min-w-0 flex-1 rounded-md border border-border/60 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-primary"
      />
      <button
        onClick={submit}
        disabled={!title.trim()}
        aria-label="Add task"
        className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * What the workspace has noticed about this record.
 *
 * The bar is signal strength — how loudly the observation is shouting relative
 * to the others — not a model's confidence. Every line is arithmetic over data
 * already on screen (see lib/mind/advice.ts), so it is checkable.
 */
function Observations({ advice, onGo }: { advice: Advice[]; onGo: (entityId: string) => void }) {
  if (!advice.length) return null;
  return (
    <div>
      <Label>What stands out</Label>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {advice.map((item) => (
          <div key={item.id} className="rounded-lg border border-border/50 bg-secondary/30 p-2.5">
            <p className="text-xs leading-relaxed">{item.text}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-[3px] w-14 overflow-hidden rounded-full bg-secondary">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(item.weight * 100)}%` }}
                />
              </span>
              <span className="font-mono text-[0.55rem] uppercase tracking-widest text-muted-foreground">
                signal
              </span>
              {item.go && (
                <button
                  onClick={() => onGo(item.go!)}
                  className="tap ml-auto rounded-md px-1.5 py-0.5 font-mono text-[0.55rem] uppercase tracking-widest text-primary hover:bg-accent"
                >
                  Go there
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NodeDetail({
  entity,
  related,
  records,
  actions,
  advice,
  gravity,
  onSelect,
  onGo,
  onEnter,
  onClose,
}: {
  entity: Entity;
  related: Entity[];
  records: MindRecords;
  actions: MindActions;
  advice: Advice[];
  /** 0..1 — how hard this record is pulling at the centre of the map. */
  gravity: number;
  onSelect: (entityId: string) => void;
  onGo: (entityId: string) => void;
  onEnter: () => void;
  onClose: () => void;
}) {
  const recordId = recordIdOf(entity.id);
  const color = KIND_COLOR[entity.kind];

  const project =
    entity.kind === "project" ? records.projects.find((p) => p.id === recordId) : null;
  const task = entity.kind === "task" ? records.tasks.find((t) => t.id === recordId) : null;
  const person = entity.kind === "person" ? records.people.find((p) => p.id === recordId) : null;
  const reminder =
    entity.kind === "reminder" ? records.reminders.find((r) => r.id === recordId) : null;
  const memory =
    entity.kind === "knowledge" ? records.memories.find((m) => m.id === recordId) : null;

  const projectTasks = project ? records.tasks.filter((t) => t.projectId === project.id) : [];
  const projectOpen = projectTasks.filter((t) => t.status !== "done");
  const parentProject = task?.projectId
    ? records.projects.find((p) => p.id === task.projectId)
    : null;

  /**
   * The node's label is cut to fit a card; this panel has room for all of it.
   * Resolved from the record rather than the graph, so nothing here is elided.
   * Knowledge is the exception — its caption is a slice of the note, and the
   * note itself is printed in full below, so repeating it as a heading would
   * only say the same thing twice.
   */
  const fullTitle =
    project?.name ?? task?.title ?? person?.name ?? reminder?.text ?? entity.label;

  const linkedPeople = new Set(related.filter((e) => e.kind === "person").map((e) => e.recordId));

  return (
    // The page owns where this sits — docked beside the map on desktop, a sheet
    // over it on phones. This only has to fill whatever it is given and scroll
    // its own content, so a long task list never pushes the map off screen.
    <div
      className="flex h-full max-h-full min-h-0 flex-col overflow-hidden"
      role="dialog"
      aria-label={`${entity.label} details`}
    >
      <div
        className="flex items-start justify-between gap-2 border-b border-border/60 px-4 py-3"
        style={{
          backgroundImage: `linear-gradient(180deg, color-mix(in oklch, ${color} 10%, transparent), transparent)`,
        }}
      >
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-widest">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span style={{ color }}>{entity.kind}</span>
          </p>
          <p className="mt-1 text-base font-medium tracking-tight text-pretty">{fullTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{entity.sublabel}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="tap -m-1 shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {/* How hard this is pulling, and how much hangs off it. */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
            Gravity
          </span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.round(gravity * 100)}%`, backgroundColor: color }}
            />
          </span>
          <span className="font-mono text-[0.6rem] tabular-nums text-muted-foreground">
            {gravity.toFixed(2)} · {related.length} linked
          </span>
        </div>

        <Observations advice={advice} onGo={onGo} />
        {/* ---- Task ---- */}
        {task && (
          <>
            {task.description && (
              <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                {task.description}
              </p>
            )}

            <div>
              <Label>Status</Label>
              <div className="mt-1.5">
                <Segmented<TaskStatus>
                  value={task.status}
                  onChange={(next) => actions.setTaskStatus(task, next)}
                  options={[
                    { value: "todo", label: "To do" },
                    { value: "doing", label: "Doing", color: STATUS_COLOR.blue },
                    { value: "blocked", label: "Blocked", color: STATUS_COLOR.orange },
                    { value: "done", label: "Done", color: STATUS_COLOR.green },
                  ]}
                />
              </div>
            </div>

            <div>
              <Label>Priority</Label>
              <div className="mt-1.5">
                <Segmented<TaskPriority>
                  value={task.priority}
                  onChange={(next) => actions.setTaskPriority(task, next)}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High", color: STATUS_COLOR.red },
                  ]}
                />
              </div>
            </div>

            <div className="divide-y divide-border/40">
              <Field label="Due">
                <span className={cn(isOverdue(task.dueDate) && "text-destructive")}>
                  {task.dueDate ? formatDate(task.dueDate) : "no deadline"}
                  {isOverdue(task.dueDate) && " · overdue"}
                </span>
              </Field>
              <Field label="Project">
                {parentProject ? (
                  <button
                    className="tap text-primary hover:underline"
                    onClick={() => onSelect(`project:${parentProject.id}`)}
                  >
                    {parentProject.name}
                  </button>
                ) : (
                  "standalone"
                )}
              </Field>
              <Field label="Added">
                {relativeDays(task.createdAt)}
                {task.source === "ai" && " · by assistant"}
              </Field>
            </div>

            <div>
              <Label>People on this</Label>
              <AssignPerson
                people={records.people}
                alreadyLinked={linkedPeople}
                onAssign={(personId) => actions.assignPerson("task", task.id, personId)}
              />
            </div>
          </>
        )}

        {/* ---- Project ---- */}
        {project && (
          <>
            {project.description && (
              <p className="text-xs leading-relaxed text-muted-foreground">{project.description}</p>
            )}

            <div>
              <Label>Status</Label>
              <div className="mt-1.5">
                <Segmented<ProjectStatus>
                  value={project.status}
                  onChange={(next) => actions.setProjectStatus(project, next)}
                  options={[
                    { value: "active", label: "Active", color: STATUS_COLOR.blue },
                    { value: "blocked", label: "Blocked", color: STATUS_COLOR.orange },
                    { value: "paused", label: "Paused", color: STATUS_COLOR.orange },
                    { value: "done", label: "Done", color: STATUS_COLOR.green },
                  ]}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Progress</Label>
                <span className="font-mono text-xs tabular-nums">{project.progress ?? 0}%</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                  <span
                    className="block h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, Math.max(0, project.progress ?? 0))}%`,
                      backgroundColor: color,
                    }}
                  />
                </span>
                <button
                  onClick={() =>
                    actions.setProjectProgress(project, Math.max(0, (project.progress ?? 0) - 10))
                  }
                  aria-label="Decrease progress"
                  className="tap flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-foreground"
                >
                  −
                </button>
                <button
                  onClick={() =>
                    actions.setProjectProgress(project, Math.min(100, (project.progress ?? 0) + 10))
                  }
                  aria-label="Increase progress"
                  className="tap flex h-8 w-8 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:text-foreground"
                >
                  +
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label>Tasks</Label>
                <span className="font-mono text-[0.6rem] text-muted-foreground">
                  {projectOpen.length} open · {projectTasks.length - projectOpen.length} done
                </span>
              </div>
              <div className="mt-1 flex flex-col">
                {projectTasks.map((t) => (
                  <Row
                    key={t.id}
                    color={taskDotColor(t)}
                    title={t.title}
                    meta={t.status === "done" ? "done" : t.priority}
                    onClick={() => onSelect(`task:${t.id}`)}
                  />
                ))}
              </div>
              <AddTask onAdd={(title) => actions.addTask(project.id, title)} />
            </div>

            <div>
              <Label>People on this</Label>
              <AssignPerson
                people={records.people}
                alreadyLinked={linkedPeople}
                onAssign={(personId) => actions.assignPerson("project", project.id, personId)}
              />
            </div>
          </>
        )}

        {/* ---- Person ---- */}
        {person && (
          <>
            <div className="divide-y divide-border/40">
              <Field label="Company">{person.company || "—"}</Field>
              <Field label="Known since">{relativeDays(person.createdAt)}</Field>
            </div>
            {person.notes && (
              <div>
                <Label>What you know</Label>
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                  {person.notes}
                </p>
              </div>
            )}
          </>
        )}

        {/* ---- Reminder ---- */}
        {reminder && (
          <>
            <div className="divide-y divide-border/40">
              <Field label="Due">
                <span className={cn(isOverdue(reminder.dueAt) && "text-destructive")}>
                  {formatDate(reminder.dueAt)}
                </span>
              </Field>
              <Field label="When">{relativeDays(reminder.dueAt)}</Field>
            </div>
            {reminder.status === "pending" && (
              <Button variant="outline" size="sm" onClick={() => actions.completeReminder(reminder)}>
                Mark done
              </Button>
            )}
          </>
        )}

        {/* ---- Knowledge ---- */}
        {memory && (
          <>
            {/* The node caption is truncated to fit a card; this is the whole of it. */}
            <p className="whitespace-pre-line text-xs leading-relaxed">{memory.content}</p>
            <div className="divide-y divide-border/40">
              <Field label="Kind">{memory.type}</Field>
              <Field label="Recorded">
                {relativeDays(memory.createdAt)}
                {memory.source === "ai" && " · by assistant"}
              </Field>
            </div>
          </>
        )}

        {/* ---- Everything this connects to ---- */}
        {related.length > 0 && (
          <div>
            <Label>Connected ({related.length})</Label>
            <div className="mt-1 flex flex-col">
              {related.map((other) => (
                <Row
                  key={other.id}
                  color={other.urgent ? STATUS_COLOR.red : KIND_COLOR[other.kind]}
                  title={other.label}
                  meta={other.kind}
                  onClick={() => onSelect(other.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {related.length > 0 && (
        <div className="border-t border-border/60 px-4 py-3">
          <Button variant="outline" size="sm" className="w-full" onClick={onEnter}>
            Centre on {entity.label}
          </Button>
        </div>
      )}
    </div>
  );
}
