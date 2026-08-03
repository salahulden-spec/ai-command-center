"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, Home, Minus, Plus } from "lucide-react";
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
  layoutOrbit,
  relationsOf,
  OWNER_ID,
  type Entity,
  type EntityKind,

} from "@/lib/mind/universe";
import { NodeDetail, type MindActions } from "@/components/mind/node-detail";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Mind View — you are always standing somewhere, seeing what it connects to.
 *
 * One focal record sits at the centre; everything related to it is arranged
 * around it in labelled sectors by type (see lib/mind/universe.ts). Clicking a
 * neighbour inspects it; clicking again travels there, and the picture re-forms
 * around the new centre.
 *
 * Because every line runs from the centre outward, the drawing is a star: no
 * arrangement of the data can produce crossing edges, and what is on screen is
 * bounded by how connected one record is rather than by how large the
 * workspace has grown.
 */

const KIND_STYLE: Record<EntityKind, { color: string; label: string; radius: number }> = {
  owner: { color: "oklch(0.85 0.17 195)", label: "You", radius: 26 },
  project: { color: "oklch(0.72 0.19 285)", label: "Projects", radius: 22 },
  task: { color: "oklch(0.78 0.14 215)", label: "Tasks", radius: 17 },
  person: { color: "oklch(0.8 0.15 160)", label: "People", radius: 18 },
  reminder: { color: "oklch(0.83 0.16 85)", label: "Reminders", radius: 16 },
};

const URGENT = "oklch(0.68 0.21 25)";
const DONE_OPACITY = 0.34;

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.4;
/** Pointer travel (CSS px) before a press counts as a pan rather than a tap. */
const TAP_SLOP = 6;
/** How long the picture takes to re-form after travelling. */
const MORPH_MS = 620;
const PANEL_W = 340;
const DESKTOP_MIN = 768;

interface Camera {
  x: number;
  y: number;
  k: number;
}

export default function MindPage() {
  const { user } = useAuth();
  const [canvasRef, size] = useElementSize();

  const { data: projects, loading } = useCollection(useMemo(() => projectsQuery(), []));
  const { data: tasks } = useCollection(useMemo(() => allTasksQuery(), []));
  const { data: people } = useCollection(useMemo(() => peopleQuery(), []));
  const { data: reminders } = useCollection(useMemo(() => remindersQuery(), []));
  const { data: links } = useCollection(useMemo(() => linksQuery(), []));

  const ownerName = user?.displayName?.split(" ")[0] || "You";

  const universe = useMemo(
    () =>
      buildUniverse({ ownerName, projects, tasks, people, reminders, links, now: new Date() }),
    [ownerName, projects, tasks, people, reminders, links]
  );

  const [trail, setTrail] = useState<string[]>([OWNER_ID]);
  const focalId = trail[trail.length - 1];
  const focal = universe.byId.get(focalId) ?? universe.byId.get(OWNER_ID)!;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (universe.byId.get(selectedId) ?? null) : null;
  const [showDone, setShowDone] = useState(false);

  const allGroups = useMemo(() => relationsOf(universe, focal.id), [universe, focal.id]);
  const groups = useMemo(() => {
    if (showDone) return allGroups;
    // Finished work stays in the graph but is out of the default picture: this
    // view is about what is still live.
    return allGroups
      .map((g) => ({ ...g, items: g.items.filter((e) => !e.done) }))
      .filter((g) => g.items.length > 0);
  }, [allGroups, showDone]);

  const doneCount = useMemo(
    () => allGroups.reduce((n, g) => n + g.items.filter((e) => e.done).length, 0),
    [allGroups]
  );

  const { placed, sectors, extent } = useMemo(() => layoutOrbit(groups), [groups]);

  // --- camera ------------------------------------------------------------
  /**
   * Panning is stored against the picture it belongs to. When the focus, the
   * canvas size or the panel changes, the stored key no longer matches and the
   * fitted camera takes over — derived during render rather than reset from an
   * effect.
   */
  const [camera, setCamera] = useState<{ key: string; value: Camera } | null>(null);

  const fitted = useMemo<Camera>(() => {
    if (!size.width || !size.height) return { x: 0, y: 0, k: 1 };
    const desktop = size.width >= DESKTOP_MIN;
    const clearW = desktop && selectedId ? size.width - PANEL_W : size.width;
    const clearH = !desktop && selectedId ? size.height * 0.38 : size.height;
    // +55 leaves room for the caption under the outermost ring; the ring radii
    // already guarantee spacing, so extra padding only shrinks the picture.
    const k = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min(clearW, clearH) / ((extent + 55) * 2))
    );
    return { k, x: clearW / 2, y: clearH / 2 };
  }, [size.width, size.height, extent, selectedId]);

  const viewKey = `${focalId}|${size.width}|${size.height}|${selectedId ?? ""}`;
  const view = camera?.key === viewKey ? camera.value : fitted;
  const setView = (next: Camera) => setCamera({ key: viewKey, value: next });

  const travelTo = (id: string) => {
    if (id === focalId) return;
    setTrail((current) => {
      const at = current.indexOf(id);
      // Stepping back onto somewhere already visited truncates the trail
      // instead of growing it, so the breadcrumbs stay an honest path.
      return at === -1 ? [...current, id] : current.slice(0, at + 1);
    });
    setSelectedId(id === OWNER_ID ? null : id);
  };

  // --- gestures ----------------------------------------------------------
  const gesture = useRef({
    pointers: new Map<number, { x: number; y: number; sx: number; sy: number }>(),
    panned: false,
    startGap: 0,
    startK: 1,
  });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (g.pointers.size === 1) g.panned = false;
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.startGap = Math.hypot(b.x - a.x, b.y - a.y);
      g.startK = view.k;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is an enhancement; the gesture still works without it.
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const prev = g.pointers.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY, sx: prev.sx, sy: prev.sy };
    g.pointers.set(e.pointerId, now);
    if (Math.hypot(now.x - prev.sx, now.y - prev.sy) > TAP_SLOP) g.panned = true;

    if (g.pointers.size === 1 && g.panned) {
      setView({ ...view, x: view.x + (now.x - prev.x), y: view.y + (now.y - prev.y) });
    } else if (g.pointers.size === 2 && g.startGap > 0) {
      const [a, b] = [...g.pointers.values()];
      const gap = Math.hypot(b.x - a.x, b.y - a.y);
      setView({
        ...view,
        k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.startK * gap) / g.startGap)),
      });
      g.panned = true;
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    gesture.current.pointers.delete(e.pointerId);
  };

  const zoomBy = (factor: number) =>
    setView({ ...view, k: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor)) });

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

  const relatedOfSelected = useMemo(() => {
    if (!selectedId) return [];
    return [...(universe.edges.get(selectedId) ?? [])]
      .map((id) => universe.byId.get(id))
      .filter((e): e is Entity => !!e);
  }, [selectedId, universe]);

  const ringRadii = useMemo(
    () => [...new Set(placed.map((p) => Math.round(Math.hypot(p.x, p.y))))],
    [placed]
  );
  const urgentHere = placed.filter((p) => p.entity.urgent).length;

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] flex-col gap-2 md:h-[calc(100dvh-3rem)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Mind View</h1>
          <p className="font-mono text-[0.65rem] text-muted-foreground">
            {universe.byId.size - 1} records · {placed.length} connected here
            {urgentHere > 0 && <span className="text-destructive"> · {urgentHere} urgent</span>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {doneCount > 0 && (
            <Button
              variant={showDone ? "default" : "outline"}
              size="sm"
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone ? "Hide done" : `Show ${doneCount} done`}
            </Button>
          )}
          <Button variant="outline" size="icon" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Back to you"
            onClick={() => {
              setTrail([OWNER_ID]);
              setSelectedId(null);
            }}
          >
            <Home className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* The path walked to get here. */}
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
                  "tap rounded-md px-2 py-1 font-mono text-[0.7rem]",
                  !last && "text-muted-foreground hover:text-foreground"
                )}
                style={last ? { color: KIND_STYLE[entity.kind].color } : undefined}
              >
                {entity.label}
              </button>
            </span>
          );
        })}
      </nav>

      <div ref={canvasRef} className="surface relative min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full flex-col gap-3 p-6">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-full w-full" />
          </div>
        ) : (
          <svg
            className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={() => {
              if (!gesture.current.panned) setSelectedId(null);
            }}
            role="application"
            aria-label="Workspace map"
          >
            <defs>
              <radialGradient id="focal-halo">
                <stop offset="0%" stopColor={KIND_STYLE[focal.kind].color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={KIND_STYLE[focal.kind].color} stopOpacity="0" />
              </radialGradient>
            </defs>

            <g transform={`translate(${view.x}, ${view.y}) scale(${view.k})`}>
              {/* Quiet ring guides, so the sectors read as deliberate structure. */}
              {ringRadii.map((r) => (
                <circle
                  key={r}
                  r={r}
                  fill="none"
                  className="text-border"
                  stroke="currentColor"
                  strokeOpacity={0.28}
                  strokeDasharray="2 8"
                />
              ))}

              <circle r={170} fill="url(#focal-halo)" />

              {/* Spokes. Every line starts at the centre, so none can cross. */}
              {placed.map((p) => {
                const active = selectedId === p.entity.id;
                return (
                  <line
                    key={`spoke-${p.entity.id}`}
                    x1={0}
                    y1={0}
                    x2={p.x}
                    y2={p.y}
                    stroke={p.entity.urgent ? URGENT : KIND_STYLE[p.kind].color}
                    strokeWidth={active ? 2 : 1}
                    strokeOpacity={active ? 0.8 : p.entity.done ? 0.1 : 0.26}
                    style={{ transition: `all ${MORPH_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` }}
                  />
                );
              })}

              {/* Sector captions, just inside the first ring. */}
              {sectors.map((s) => (
                <text
                  key={s.kind}
                  x={Math.cos(s.angle) * (s.radius - 58)}
                  y={Math.sin(s.angle) * (s.radius - 58)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none font-mono uppercase"
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    fill: KIND_STYLE[s.kind].color,
                    opacity: 0.6,
                  }}
                >
                  {KIND_STYLE[s.kind].label} · {s.count}
                </text>
              ))}

              {/* Neighbours. */}
              {placed.map((p) => {
                const style = KIND_STYLE[p.kind];
                const active = selectedId === p.entity.id;
                const color = p.entity.urgent ? URGENT : style.color;
                const degree = (universe.edges.get(p.entity.id)?.size ?? 1) - 1;
                return (
                  <g
                    key={p.entity.id}
                    className="cursor-pointer"
                    style={{
                      transform: `translate(${p.x}px, ${p.y}px)`,
                      transition: `transform ${MORPH_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms ease`,
                      opacity: p.entity.done ? DONE_OPACITY : 1,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (gesture.current.panned) return;
                      // First tap inspects, second travels — so a node can be
                      // read without losing the neighbourhood you are in.
                      if (selectedId === p.entity.id) travelTo(p.entity.id);
                      else setSelectedId(p.entity.id);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      travelTo(p.entity.id);
                    }}
                  >
                    <circle r={Math.max(style.radius + 12, 22)} fill="transparent" />
                    {p.entity.urgent && !p.entity.done && (
                      <circle
                        className="pulse-ring"
                        r={style.radius + 4}
                        fill="none"
                        stroke={URGENT}
                        strokeWidth={1.5}
                      />
                    )}
                    <circle
                      r={style.radius}
                      fill="var(--card)"
                      stroke={color}
                      strokeWidth={active ? 3 : 2}
                      style={{ filter: `drop-shadow(0 0 ${active ? 12 : 5}px ${color})` }}
                    />
                    {/* How much hangs off this one — a reason to travel into it. */}
                    {degree > 0 && (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="pointer-events-none font-mono"
                        style={{ fontSize: 9.5, fill: color, opacity: 0.95 }}
                      >
                        {degree}
                      </text>
                    )}
                    <text
                      y={style.radius + 15}
                      textAnchor="middle"
                      className="pointer-events-none fill-foreground font-mono"
                      style={{
                        fontSize: 11,
                        paintOrder: "stroke",
                        stroke: "var(--background)",
                        strokeWidth: 5,
                        strokeLinejoin: "round",
                      }}
                    >
                      {p.entity.label}
                    </text>
                  </g>
                );
              })}

              {/* The focal record, drawn last so it always sits on top. */}
              <g>
                <circle
                  r={KIND_STYLE[focal.kind].radius + 9}
                  fill="none"
                  stroke={KIND_STYLE[focal.kind].color}
                  strokeOpacity={0.35}
                />
                <circle
                  r={KIND_STYLE[focal.kind].radius}
                  fill="var(--card)"
                  stroke={KIND_STYLE[focal.kind].color}
                  strokeWidth={2.5}
                  style={{ filter: `drop-shadow(0 0 16px ${KIND_STYLE[focal.kind].color})` }}
                />
                <text
                  y={KIND_STYLE[focal.kind].radius + 24}
                  textAnchor="middle"
                  className="pointer-events-none fill-foreground font-mono"
                  style={{
                    fontSize: 15,
                    paintOrder: "stroke",
                    stroke: "var(--background)",
                    strokeWidth: 6,
                    strokeLinejoin: "round",
                  }}
                >
                  {focal.label}
                </text>
                <text
                  y={KIND_STYLE[focal.kind].radius + 40}
                  textAnchor="middle"
                  className="pointer-events-none font-mono"
                  style={{
                    fontSize: 10,
                    fill: KIND_STYLE[focal.kind].color,
                    opacity: 0.85,
                    paintOrder: "stroke",
                    stroke: "var(--background)",
                    strokeWidth: 5,
                    strokeLinejoin: "round",
                  }}
                >
                  {focal.sublabel}
                </text>
              </g>
            </g>
          </svg>
        )}

        {!loading && placed.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">
              Nothing connects to {focal.label} yet. Assign someone or add a task and it appears
              here immediately.
            </p>
          </div>
        )}

        {selected && (
          <NodeDetail
            entity={selected}
            related={relatedOfSelected}
            records={{ projects, tasks, people, reminders }}
            actions={actions}
            onSelect={setSelectedId}
            onEnter={() => travelTo(selected.id)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
