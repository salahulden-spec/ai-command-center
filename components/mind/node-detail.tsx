"use client";

import Link from "next/link";
import { Crosshair, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OsNode, OsStatus } from "@/lib/mind/os-graph";
import type { Person, Project, Reminder, Task } from "@/types";

/**
 * The inspector for a selected node.
 *
 * A node in the graph is a marker, not the record — it carries only what the
 * canvas needs to draw. Everything worth reading lives in the Firestore
 * documents the page already has in memory, so this resolves the node back to
 * its record by id and renders the real thing: a project's description,
 * progress, and full task list; a task's priority, deadline and parent; a
 * contact's notes and everything they touch.
 *
 * Node ids are `${kind}-${firestoreId}`. Split on the FIRST hyphen only —
 * this workspace has historically contained ids with spaces and hyphens in
 * them, and splitting greedily would silently fail to resolve those records.
 */

export interface MindRecords {
  projects: Project[];
  tasks: Task[];
  people: Person[];
  reminders: Reminder[];
}

const STATUS_COLOR: Record<OsStatus, string> = {
  green: "oklch(0.82 0.16 155)",
  blue: "oklch(0.74 0.16 245)",
  orange: "oklch(0.83 0.16 85)",
  red: "oklch(0.68 0.21 25)",
  gray: "oklch(0.55 0.02 250)",
  neutral: "oklch(0.8 0.09 200)",
};

export function entityIdOf(nodeId: string): string {
  const i = nodeId.indexOf("-");
  return i === -1 ? nodeId : nodeId.slice(i + 1);
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

/** One tappable line for a related record — the panel's navigation primitive. */
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
        "tap flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
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

export function NodeDetail({
  node,
  records,
  relatedIds,
  nodeIndex,
  onSelect,
  onFocus,
  onClose,
}: {
  node: OsNode;
  records: MindRecords;
  relatedIds: string[];
  nodeIndex: Map<string, OsNode>;
  onSelect: (nodeId: string) => void;
  onFocus: () => void;
  onClose: () => void;
}) {
  const entityId = entityIdOf(node.id);
  const color = node.kind === "owner" ? "var(--primary)" : STATUS_COLOR[node.status];

  const project = node.kind === "project" ? records.projects.find((p) => p.id === entityId) : null;
  const task = node.kind === "task" ? records.tasks.find((t) => t.id === entityId) : null;
  const person = node.kind === "person" ? records.people.find((p) => p.id === entityId) : null;
  const reminder =
    node.kind === "reminder" ? records.reminders.find((r) => r.id === entityId) : null;

  const projectTasks = project ? records.tasks.filter((t) => t.projectId === project.id) : [];
  const projectOpen = projectTasks.filter((t) => t.status !== "done");
  const parentProject = task?.projectId
    ? records.projects.find((p) => p.id === task.projectId)
    : null;

  return (
    <div
      className={cn(
        // Bottom sheet on phones, right rail on desktop — both scroll their
        // own content so a long task list never pushes the graph off screen.
        "surface animate-rise absolute z-20 flex flex-col overflow-hidden",
        "inset-x-2 bottom-2 max-h-[62svh]",
        "md:inset-x-auto md:bottom-auto md:right-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-80"
      )}
      role="dialog"
      aria-label={`${node.label} details`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{node.label}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            {node.kind === "ghost" ? "AI suggestion" : node.kind} · {node.sublabel}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="tap -m-1 shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {node.detail && (
          <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
            {node.detail}
          </p>
        )}

        {/* ---- Project ---- */}
        {project && (
          <>
            {project.description && (
              <p className="text-xs leading-relaxed text-muted-foreground">{project.description}</p>
            )}
            <div className="mt-2 divide-y divide-border/40">
              <Field label="Status">{project.status}</Field>
              <Field label="Progress">
                <span className="flex items-center justify-end gap-2">
                  <span className="h-1 w-16 overflow-hidden rounded-full bg-secondary">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, project.progress ?? 0))}%`,
                        backgroundColor: color,
                      }}
                    />
                  </span>
                  <span className="font-mono tabular-nums">{project.progress ?? 0}%</span>
                </span>
              </Field>
              <Field label="Tasks">
                <span className="font-mono tabular-nums">
                  {projectOpen.length} open · {projectTasks.length - projectOpen.length} done
                </span>
              </Field>
              <Field label="Updated">{relativeDays(project.updatedAt)}</Field>
            </div>

            {project.objectives?.length > 0 && (
              <>
                <SectionLabel>Objectives</SectionLabel>
                <ul className="mt-1 flex flex-col gap-1">
                  {project.objectives.map((o, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      • {o}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {projectTasks.length > 0 && (
              <>
                <SectionLabel>Tasks</SectionLabel>
                <div className="mt-1 flex flex-col">
                  {projectTasks.map((t) => (
                    <Row
                      key={t.id}
                      color={taskDotColor(t)}
                      title={t.title}
                      meta={t.status === "done" ? "done" : t.priority}
                      onClick={
                        nodeIndex.has(`task-${t.id}`) ? () => onSelect(`task-${t.id}`) : undefined
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ---- Task ---- */}
        {task && (
          <>
            {task.description && (
              <p className="text-xs leading-relaxed text-muted-foreground">{task.description}</p>
            )}
            <div className="mt-2 divide-y divide-border/40">
              <Field label="Status">{task.status}</Field>
              <Field label="Priority">
                <span className={cn(task.priority === "high" && "text-destructive")}>
                  {task.priority}
                </span>
              </Field>
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
                    onClick={() => onSelect(`project-${parentProject.id}`)}
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
              <>
                <SectionLabel>What you know</SectionLabel>
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                  {person.notes}
                </p>
              </>
            )}
          </>
        )}

        {/* ---- Reminder ---- */}
        {reminder && (
          <div className="divide-y divide-border/40">
            <Field label="Due">
              <span className={cn(isOverdue(reminder.dueAt) && "text-destructive")}>
                {formatDate(reminder.dueAt)}
              </span>
            </Field>
            <Field label="When">{relativeDays(reminder.dueAt)}</Field>
            <Field label="Status">{reminder.status}</Field>
          </div>
        )}

        {/* ---- Hubs and clusters: what's inside ---- */}
        {(node.kind === "hub" || node.kind === "cluster" || node.kind === "owner") &&
          node.children.length > 0 && (
            <>
              <SectionLabel>Contains ({node.children.length})</SectionLabel>
              <div className="mt-1 flex flex-col">
                {node.children.map((c) => (
                  <Row
                    key={c.id}
                    color={c.kind === "owner" ? "var(--primary)" : STATUS_COLOR[c.status]}
                    title={c.label}
                    meta={c.alerts > 0 ? `${c.alerts} urgent` : c.sublabel}
                    onClick={() => onSelect(c.id)}
                  />
                ))}
              </div>
            </>
          )}

        {/* ---- Relationships ---- */}
        {relatedIds.length > 0 && (
          <>
            <SectionLabel>Connected to</SectionLabel>
            <div className="mt-1 flex flex-col">
              {relatedIds.map((id) => {
                const other = nodeIndex.get(id);
                if (!other) return null;
                return (
                  <Row
                    key={id}
                    color={other.kind === "owner" ? "var(--primary)" : STATUS_COLOR[other.status]}
                    title={other.label}
                    meta={other.kind}
                    onClick={() => onSelect(id)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2 border-t border-border/60 px-4 py-3">
        {node.children.length > 0 && (
          <Button variant="outline" size="sm" className="flex-1" onClick={onFocus}>
            <Crosshair className="mr-1.5 h-3.5 w-3.5" />
            Focus
          </Button>
        )}
        {node.href && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            nativeButton={false}
            render={
              <Link href={node.href}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open
              </Link>
            }
          />
        )}
      </div>
    </div>
  );
}
