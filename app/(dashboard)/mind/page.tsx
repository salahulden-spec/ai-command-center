"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Check,
  ChevronRight,
  Home,
  Layers,
  Minus,
  Orbit,
  Plus,
  Sparkles,
  User,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useElementSize } from "@/hooks/use-element-size";
import { projectsQuery, updateProject } from "@/lib/firestore/projects";
import { allTasksQuery, updateTask, createTask } from "@/lib/firestore/tasks";
import { peopleQuery } from "@/lib/firestore/people";
import { remindersQuery, markReminderDone } from "@/lib/firestore/reminders";
import { linksQuery, createLink } from "@/lib/firestore/links";
import {
  buildUniverse,
  relationsOf,
  OWNER_ID,
  type Entity,
  type EntityKind,
} from "@/lib/mind/universe";
import { gravityOf, layoutNeighbourhood } from "@/lib/mind/spatial";
import { MindStage, type StageFrame } from "@/lib/mind/stage";
import { adviceFor } from "@/lib/mind/advice";
import { NodeDetail, type MindActions } from "@/components/mind/node-detail";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import "./mind.css";

/**
 * Mind View — the workspace as a place you stand in rather than a chart.
 *
 * One record holds the centre. Everything attached to it is arranged around it
 * in sectors by type, and everything attached to *those* fans out one ring
 * further, so opening a project shows its tasks and hints at what those tasks
 * touch. Tap once to read a record, tap again to walk into it.
 *
 * Three things make it a space rather than a diagram:
 *
 * - **Gravity.** Ring distance is `base + (1 - gravity) * spread`, so an
 *   overdue task sits nearer the centre than a finished one. The picture ranks
 *   itself (lib/mind/spatial.ts).
 * - **Level of detail.** Zoomed out, cards collapse to labelled pills; zoomed
 *   in they open into progress bars and status chips. One node, three
 *   densities.
 * - **A render loop, not transitions.** lib/mind/stage.ts springs positions
 *   toward their targets and writes transforms directly. Nothing here
 *   re-renders at 60fps.
 */

const KIND_STYLE: Record<
  EntityKind,
  { color: string; label: string; plural: string; icon: React.ComponentType<{ className?: string }> }
> = {
  owner: { color: "oklch(0.85 0.17 195)", label: "You", plural: "You", icon: Orbit },
  project: { color: "oklch(0.72 0.19 285)", label: "Project", plural: "Projects", icon: Layers },
  task: { color: "oklch(0.78 0.14 215)", label: "Task", plural: "Tasks", icon: Check },
  person: { color: "oklch(0.8 0.15 160)", label: "Person", plural: "People", icon: User },
  reminder: { color: "oklch(0.83 0.16 85)", label: "Reminder", plural: "Reminders", icon: Bell },
};

const SECTOR_STYLE = Object.fromEntries(
  Object.entries(KIND_STYLE).map(([kind, style]) => [kind, { color: style.color, label: style.plural }])
) as StageFrame["sectorStyle"];

const FILTER_KINDS: EntityKind[] = ["project", "task", "person", "reminder"];
const URGENT = "oklch(0.68 0.21 25)";
/** Pointer travel before a press counts as a pan rather than a tap. */
const TAP_SLOP = 6;
/** How many records an attention run walks through. */
const ATTENTION_LIMIT = 5;

function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "··";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function MindPage() {
  const { user } = useAuth();
  const [sizeRef, size] = useElementSize();

  const { data: projects, loading } = useCollection(useMemo(() => projectsQuery(), []));
  const { data: tasks } = useCollection(useMemo(() => allTasksQuery(), []));
  const { data: people } = useCollection(useMemo(() => peopleQuery(), []));
  const { data: reminders } = useCollection(useMemo(() => remindersQuery(), []));
  const { data: links } = useCollection(useMemo(() => linksQuery(), []));

  const worldRef = useRef<HTMLDivElement>(null);
  const netRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const lodLabelRef = useRef<HTMLSpanElement>(null);

  // Created once. A ref would have to be initialised during render, which is
  // exactly what the compiler forbids; a state initialiser runs once and the
  // instance never changes identity.
  const [stage] = useState(
    () =>
      new MindStage({
        world: worldRef,
        canvas: netRef,
        zoomLabel: zoomLabelRef,
        lodLabel: lodLabelRef,
      })
  );

  const ownerName = user?.displayName?.split(" ")[0] || "You";

  const universe = useMemo(
    () => buildUniverse({ ownerName, projects, tasks, people, reminders, links, now: new Date() }),
    [ownerName, projects, tasks, people, reminders, links]
  );

  const [trail, setTrail] = useState<string[]>([OWNER_ID]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [hidden, setHidden] = useState<Set<EntityKind>>(() => new Set());
  const [attention, setAttention] = useState<{ queue: string[]; index: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const focalId = trail[trail.length - 1];
  const focal = universe.byId.get(focalId) ?? universe.byId.get(OWNER_ID)!;
  const selected = selectedId ? (universe.byId.get(selectedId) ?? null) : null;

  const relations = useMemo(() => relationsOf(universe, focal.id), [universe, focal.id]);
  const spatial = useMemo(
    () => layoutNeighbourhood(universe, focal, relations, { showDone, hidden }),
    [universe, focal, relations, showDone, hidden]
  );

  const doneCount = useMemo(
    () => relations.reduce((n, g) => n + g.items.filter((e) => e.done).length, 0),
    [relations]
  );
  const urgentHere = spatial.placed.filter((p) => p.entity.urgent && p.depth === 1).length;

  /** Every connection between two records that are both on screen. */
  const edges = useMemo(() => {
    const on = new Set(spatial.placed.map((p) => p.entity.id));
    const out: [string, string][] = [];
    const seen = new Set<string>();
    for (const id of on) {
      for (const other of universe.edges.get(id) ?? []) {
        if (!on.has(other)) continue;
        const key = id < other ? `${id}|${other}` : `${other}|${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([id, other]);
      }
    }
    return out;
  }, [spatial.placed, universe.edges]);

  const attentionSet = useMemo(() => {
    if (!attention) return null;
    const set = new Set<string>();
    for (const id of attention.queue) {
      set.add(id);
      for (const other of universe.edges.get(id) ?? []) set.add(other);
    }
    return set;
  }, [attention, universe.edges]);

  const highlightId = hoverId ?? selectedId;
  const highlightSet = useMemo(() => {
    if (!highlightId) return null;
    return new Set<string>([highlightId, ...(universe.edges.get(highlightId) ?? [])]);
  }, [highlightId, universe.edges]);

  const frame = useMemo<StageFrame>(
    () => ({
      placed: spatial.placed,
      sectors: spatial.sectors,
      extent: spatial.extent,
      edges,
      colors: new Map(
        spatial.placed.map((p) => [
          p.entity.id,
          p.entity.urgent && !p.entity.done ? URGENT : KIND_STYLE[p.entity.kind].color,
        ])
      ),
      sectorStyle: SECTOR_STYLE,
    }),
    [spatial, edges]
  );

  // The layout or the available space changed: hand the stage a new frame and
  // let it re-fit. `size` is only a trigger — the stage measures the DOM itself.
  useLayoutEffect(() => {
    stage.sync(frame);
  }, [stage, frame, size.width, size.height]);

  // Hover and the attention run only repaint; they never move a card.
  useEffect(() => {
    stage.setOverlay(highlightSet, attentionSet);
  }, [stage, highlightSet, attentionSet]);

  useEffect(() => stage.start(), [stage]);

  // --- travelling --------------------------------------------------------
  const travelTo = (id: string) => {
    if (!universe.byId.has(id)) return;
    setTrail((current) => {
      const at = current.indexOf(id);
      return at === -1 ? [...current, id] : current.slice(0, at + 1);
    });
    setSelectedId(null);
    setHoverId(null);
  };

  const tapNode = (id: string) => {
    if (id === focalId) {
      if (trail.length > 1) travelTo(trail[trail.length - 2]);
      return;
    }
    // First tap reads it without losing the neighbourhood; second walks in.
    if (selectedId === id) travelTo(id);
    else setSelectedId(id);
  };

  // --- gestures ----------------------------------------------------------
  const press = useRef<{
    id: string | null;
    x: number;
    y: number;
    moved: boolean;
    origin: { x: number; y: number };
  } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ gap: number; k: number } | null>(null);

  const idFromEvent = (e: { target: EventTarget | null }) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(".mv-node");
    return el && el.dataset.dim !== "true" ? (el.dataset.id ?? null) : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size > 1) {
      press.current = null;
      return;
    }
    press.current = {
      id: idFromEvent(e),
      x: e.clientX,
      y: e.clientY,
      moved: false,
      origin: stage.panOrigin(),
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an enhancement; the gesture still works without it.
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (!pinch.current) pinch.current = { gap, k: stage.zoom };
      else stage.zoomTo((pinch.current.k * gap) / pinch.current.gap);
      return;
    }

    const p = press.current;
    if (!p) {
      const id = idFromEvent(e);
      if (id !== hoverId) setHoverId(id);
      if (id) placePreview(e);
      return;
    }

    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) > TAP_SLOP) {
      p.moved = true;
      setPanning(true);
      setHoverId(null);
    }
    if (p.moved) stage.panTo(p.origin, dx, dy);
  };

  const endPress = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const p = press.current;
    press.current = null;
    setPanning(false);
    if (!p || p.moved) return;
    // Pointer capture retargets this event to the stage, so the record under
    // the pointer when it went *down* is the one that was tapped.
    if (p.id) tapNode(p.id);
    else setSelectedId(null);
  };

  function placePreview(e: React.PointerEvent) {
    const el = previewRef.current;
    const host = worldRef.current?.parentElement;
    if (!el || !host) return;
    const r = host.getBoundingClientRect();
    const w = 254;
    const h = el.offsetHeight || 120;
    let x = e.clientX - r.left + 18;
    let y = e.clientY - r.top + 16;
    if (x + w > r.width - 12) x = e.clientX - r.left - w - 18;
    if (y + h > r.height - 12) y = r.height - h - 12;
    el.style.left = `${Math.max(12, x)}px`;
    el.style.top = `${Math.max(12, y)}px`;
  }

  // --- attention ---------------------------------------------------------
  const toggleAttention = () => {
    if (attention) {
      setAttention(null);
      return;
    }
    const open = [...universe.byId.values()].filter((e) => e.kind !== "owner" && !e.done);
    const urgent = open.filter((e) => e.urgent);
    const queue = (urgent.length ? urgent : open)
      .sort((a, b) => gravityOf(b) - gravityOf(a))
      .slice(0, ATTENTION_LIMIT)
      .map((e) => e.id);
    if (!queue.length) return;
    setAttention({ queue, index: 0 });
    setTrail([OWNER_ID, queue[0]]);
    setSelectedId(queue[0]);
  };

  const attentionStep = () => {
    if (!attention) return;
    const index = (attention.index + 1) % attention.queue.length;
    setAttention({ ...attention, index });
    setTrail([OWNER_ID, attention.queue[index]]);
    setSelectedId(attention.queue[index]);
  };

  // --- writes ------------------------------------------------------------
  const actions = useMemo<MindActions>(
    () => ({
      setTaskStatus: (task, status) => void updateTask(task.projectId, task.id, { status }),
      setTaskPriority: (task, priority) => void updateTask(task.projectId, task.id, { priority }),
      setProjectStatus: (project, status) => void updateProject(project.id, { status }),
      setProjectProgress: (project, progress) => void updateProject(project.id, { progress }),
      addTask: (projectId, title) => void createTask({ title, projectId }),
      assignPerson: (targetType, targetId, personId) =>
        void createLink("person", personId, targetType, targetId),
      completeReminder: (reminder) => void markReminderDone(reminder.id),
    }),
    []
  );

  const relatedOf = (id: string | null) =>
    id
      ? [...(universe.edges.get(id) ?? [])]
          .map((other) => universe.byId.get(other))
          .filter((e): e is Entity => !!e)
      : [];

  const relatedOfSelected = useMemo(
    () => relatedOf(selectedId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, universe]
  );

  const advice = useMemo(() => {
    if (!selected) return [];
    return adviceFor(universe, selected, { projects, tasks, people, reminders, now: new Date() });
  }, [selected, universe, projects, tasks, people, reminders]);

  const hovered = hoverId ? (universe.byId.get(hoverId) ?? null) : null;
  const hoveredRelated = useMemo(
    () => relatedOf(hoverId).slice(0, 4),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hoverId, universe]
  );

  const inspector = selected && (
    <NodeDetail
      entity={selected}
      related={relatedOfSelected}
      records={{ projects, tasks, people, reminders }}
      actions={actions}
      advice={advice}
      gravity={gravityOf(selected)}
      onSelect={setSelectedId}
      onGo={travelTo}
      onEnter={() => travelTo(selected.id)}
      onClose={() => setSelectedId(null)}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] flex-col gap-2 md:h-[calc(100dvh-3rem)]">
      {/* ── header ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Mind View</h1>
          <p className="font-mono text-[0.65rem] text-muted-foreground">
            {universe.byId.size - 1} records · {Math.max(0, spatial.placed.length - 1)} around you
            {urgentHere > 0 && <span className="text-destructive"> · {urgentHere} urgent</span>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={attention ? "default" : "outline"}
            size="sm"
            onClick={toggleAttention}
            className="gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Focus
          </Button>
          {doneCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide done" : `Show ${doneCount} done`}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom out"
            onClick={() => stage.zoomBy(0.8)}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Zoom in"
            onClick={() => stage.zoomBy(1.25)}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Back to you"
            onClick={() => {
              setTrail([OWNER_ID]);
              setSelectedId(null);
              setAttention(null);
              stage.recentre();
            }}
          >
            <Home className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <nav aria-label="Path" className="no-scrollbar flex items-center gap-1 overflow-x-auto">
        {trail.map((id, i) => {
          const entity = universe.byId.get(id);
          if (!entity) return null;
          const last = i === trail.length - 1;
          return (
            <span key={id} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
              <button
                onClick={() => travelTo(id)}
                className={cn(
                  "tap flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[0.7rem]",
                  !last && "text-muted-foreground hover:text-foreground"
                )}
                style={last ? { color: KIND_STYLE[entity.kind].color } : undefined}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: KIND_STYLE[entity.kind].color }}
                />
                {entity.label}
              </button>
            </span>
          );
        })}
      </nav>

      {/* ── stage + inspector ────────────────────────────────────────── */}
      <div className="surface relative flex min-h-0 flex-1 overflow-hidden">
        <div ref={sizeRef} className="relative min-w-0 flex-1">
          {loading ? (
            <div className="flex h-full flex-col gap-3 p-6">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-full w-full" />
            </div>
          ) : (
            <div
              className="mv-stage"
              data-panning={panning}
              role="application"
              aria-label="Workspace map"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPress}
              onPointerCancel={endPress}
              onPointerLeave={() => setHoverId(null)}
              onWheel={(e) => stage.zoomBy(Math.exp(-e.deltaY * 0.0016))}
              onDoubleClick={(e) => {
                const id = idFromEvent(e);
                if (id) travelTo(id);
              }}
            >
              <canvas ref={netRef} className="mv-net" />

              <div ref={worldRef} className="mv-world" data-lod="near">
                {spatial.placed.map((p) => {
                  const entity = p.entity;
                  const style = KIND_STYLE[entity.kind];
                  const Icon = style.icon;
                  const urgent = entity.urgent && !entity.done;
                  const degree = (universe.edges.get(entity.id)?.size ?? 1) - 1;
                  const dim = attentionSet
                    ? !attentionSet.has(entity.id) && entity.id !== focalId
                    : highlightSet
                      ? !highlightSet.has(entity.id) && entity.id !== focalId
                      : false;
                  return (
                    <div
                      key={entity.id}
                      ref={(el) => stage.bindNode(entity.id, el)}
                      className="mv-node"
                      data-id={entity.id}
                      data-kind={entity.kind}
                      data-depth={p.depth}
                      data-done={entity.done}
                      data-urgent={urgent}
                      data-selected={selectedId === entity.id}
                      data-hot={highlightSet ? highlightSet.has(entity.id) : false}
                      data-dim={dim}
                      style={{ ["--kc" as string]: urgent ? URGENT : style.color }}
                    >
                      <div className="mv-hit">
                        <div className="mv-card">
                          {entity.kind === "task" ? (
                            <div className="mv-row">
                              <span className="mv-tick">
                                <Check className="h-2.5 w-2.5" strokeWidth={4} />
                              </span>
                              <span className="mv-kind">{entity.sublabel}</span>
                            </div>
                          ) : entity.kind === "person" ? (
                            <>
                              <span className="mv-avatar">{initialsOf(entity.label)}</span>
                              <div className="min-w-0">
                                <h3 className="mv-title">{entity.label}</h3>
                                <p className="mv-sub mv-lod-1">{entity.sublabel}</p>
                              </div>
                            </>
                          ) : (
                            <div className="mv-row">
                              <span className="mv-ico">
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                              <span className="mv-kind">
                                {entity.kind === "owner" ? "" : style.label}
                              </span>
                            </div>
                          )}

                          {entity.kind !== "person" && (
                            <>
                              <h3 className="mv-title">{entity.label}</h3>
                              <p className="mv-sub mv-lod-1">{entity.sublabel}</p>
                            </>
                          )}

                          {entity.kind !== "owner" && entity.kind !== "person" && (
                            <div className="mv-chips mv-lod-2">
                              {urgent && (
                                <span className="mv-chip" data-tone="urgent">
                                  urgent
                                </span>
                              )}
                              {entity.done && (
                                <span className="mv-chip" data-tone="done">
                                  done
                                </span>
                              )}
                              {degree > 0 && <span className="mv-chip">{degree} linked</span>}
                            </div>
                          )}

                          {entity.kind === "owner" && (
                            <>
                              <span className="mv-halo" style={{ width: 174, height: 174 }} />
                              <span
                                className="mv-halo"
                                style={{ width: 212, height: 212, opacity: 0.5 }}
                              />
                            </>
                          )}
                        </div>
                        {p.depth === 0 && <span className="mv-here">you are here</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pointer-only preview, so it can never sit under a tap. */}
              <div
                ref={previewRef}
                className="mv-preview hidden md:block"
                data-on={!!hovered && hoverId !== focalId}
                aria-hidden="true"
              >
                {hovered && (
                  <>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: KIND_STYLE[hovered.kind].color }}
                      />
                      <p className="truncate text-[0.8rem] font-medium">{hovered.label}</p>
                    </div>
                    <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
                      {KIND_STYLE[hovered.kind].label} · {hovered.sublabel}
                    </p>
                    {hoveredRelated.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {hoveredRelated.map((other) => (
                          <span
                            key={other.id}
                            className="mv-chip"
                            style={{
                              color: KIND_STYLE[other.kind].color,
                              borderColor: `color-mix(in oklch, ${KIND_STYLE[other.kind].color} 36%, transparent)`,
                            }}
                          >
                            {other.label}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 border-t border-border/50 pt-2 text-[0.7rem] text-muted-foreground">
                      Tap to open · tap again to travel in
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {!loading && spatial.placed.length <= 1 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="max-w-xs text-sm text-muted-foreground">
                Nothing connects to {focal.label} yet. Assign someone or add a task and it appears
                here immediately.
              </p>
            </div>
          )}

          {/* ── bottom rail ────────────────────────────────────────── */}
          {!loading && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-2">
              <div className="no-scrollbar pointer-events-auto flex gap-1 overflow-x-auto">
                {FILTER_KINDS.map((kind) => {
                  const off = hidden.has(kind);
                  return (
                    <button
                      key={kind}
                      onClick={() =>
                        setHidden((current) => {
                          const next = new Set(current);
                          if (next.has(kind)) next.delete(kind);
                          else next.add(kind);
                          return next;
                        })
                      }
                      aria-pressed={!off}
                      className={cn(
                        "tap flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[0.6rem] uppercase tracking-widest transition-colors",
                        off ? "text-muted-foreground/40" : "text-muted-foreground hover:bg-accent"
                      )}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-[2px]"
                        style={{
                          backgroundColor: off ? "var(--muted-foreground)" : KIND_STYLE[kind].color,
                        }}
                      />
                      {KIND_STYLE[kind].plural}
                    </button>
                  );
                })}
              </div>
              <div className="hidden shrink-0 items-center gap-2 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground sm:flex">
                <span ref={lodLabelRef}>Cards</span>
                <span className="text-muted-foreground/40">·</span>
                <span ref={zoomLabelRef} className="tabular-nums">
                  1.00×
                </span>
              </div>
            </div>
          )}

          {/* ── attention run ──────────────────────────────────────── */}
          {attention && (
            <div className="surface absolute inset-x-2 top-2 z-20 flex items-center gap-2 px-3 py-2 md:inset-x-auto md:left-1/2 md:w-auto md:-translate-x-1/2">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 truncate text-xs">
                <span className="font-medium">
                  {universe.byId.get(attention.queue[attention.index])?.label ?? "—"}
                </span>
                <span className="text-muted-foreground">
                  {" · "}
                  {universe.byId.get(attention.queue[attention.index])?.sublabel}
                </span>
              </p>
              <span className="shrink-0 font-mono text-[0.6rem] tabular-nums text-muted-foreground">
                {attention.index + 1}/{attention.queue.length}
              </span>
              <Button variant="outline" size="sm" onClick={attentionStep}>
                Next
              </Button>
            </div>
          )}
        </div>

        {/* ── inspector: docked beside the map, a sheet over it on phones ── */}
        {inspector && (
          <>
            <aside className="hidden w-[340px] shrink-0 border-l border-border/60 md:block">
              {inspector}
            </aside>
            <div className="surface animate-rise absolute inset-x-2 bottom-2 z-30 max-h-[58svh] overflow-hidden md:hidden">
              {inspector}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
