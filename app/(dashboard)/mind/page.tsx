"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Minus, Plus, Maximize2, X, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useElementSize } from "@/hooks/use-element-size";
import { projectsQuery } from "@/lib/firestore/projects";
import { allTasksQuery } from "@/lib/firestore/tasks";
import { peopleQuery } from "@/lib/firestore/people";
import { remindersQuery } from "@/lib/firestore/reminders";
import { inboxQuery } from "@/lib/firestore/inbox";
import { linksQuery } from "@/lib/firestore/links";
import {
  buildOsTree,
  layoutRadial,
  type OsNode,
  type OsStatus,
  type PlacedNode,
} from "@/lib/mind/os-graph";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Mind View: the workspace as an operating system, not a mind map.
 *
 * The owner sits at the centre; categories, records, and a project's own tasks
 * radiate outward with progressive disclosure — complexity exists only where
 * it has been asked for. The layout is a deterministic radial tree (see
 * os-graph.ts), so nothing jiggles, nothing crosses, and every Firestore
 * change re-derives the picture live through the collection listeners.
 */

const STATUS_COLOR: Record<OsStatus, string> = {
  green: "oklch(0.82 0.16 155)",
  blue: "oklch(0.74 0.16 245)",
  orange: "oklch(0.83 0.16 85)",
  red: "oklch(0.68 0.21 25)",
  gray: "oklch(0.55 0.02 250)",
  neutral: "oklch(0.8 0.09 200)",
};

const STATUS_LEGEND: { status: OsStatus; label: string }[] = [
  { status: "blue", label: "In progress" },
  { status: "green", label: "Done" },
  { status: "orange", label: "Waiting" },
  { status: "red", label: "Urgent" },
];

const KIND_RADIUS = { owner: 34, hub: 19, project: 15, person: 10, task: 8, reminder: 8 } as const;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
/** Pointer travel (CSS px) before a press counts as a pan, not a tap. */
const TAP_THRESHOLD_PX = 6;

interface Transform {
  x: number;
  y: number;
  k: number;
}

function nodeColor(node: OsNode): string {
  if (node.kind === "owner") return "var(--primary)";
  return STATUS_COLOR[node.status];
}

function labelWidth(node: OsNode): number {
  return Math.max(node.label.length * 6, 40);
}

function fitTransform(placed: PlacedNode[], width: number, height: number): Transform {
  if (!placed.length || !width || !height) return { x: 0, y: 0, k: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of placed) {
    const half = Math.max(KIND_RADIUS[p.node.kind], labelWidth(p.node) / 2);
    minX = Math.min(minX, p.x - half);
    maxX = Math.max(maxX, p.x + half);
    minY = Math.min(minY, p.y - KIND_RADIUS[p.node.kind] - 8);
    maxY = Math.max(maxY, p.y + KIND_RADIUS[p.node.kind] + 22);
  }
  const k = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min(width / (maxX - minX + 60), height / (maxY - minY + 60)))
  );
  return {
    x: width / 2 - ((minX + maxX) / 2) * k,
    y: height / 2 - ((minY + maxY) / 2) * k,
    k,
  };
}

/** Gentle curve for cross-relationship arcs, bowed perpendicular to the chord. */
function arcPath(a: PlacedNode, b: PlacedNode): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mx = (a.x + b.x) / 2 - dy * 0.18;
  const my = (a.y + b.y) / 2 + dx * 0.18;
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

export default function MindPage() {
  const { user } = useAuth();
  const [canvasRef, size] = useElementSize();

  const { data: projects, loading: projectsLoading } = useCollection(
    useMemo(() => projectsQuery(), [])
  );
  const { data: tasks } = useCollection(useMemo(() => allTasksQuery(), []));
  const { data: people } = useCollection(useMemo(() => peopleQuery(), []));
  const { data: reminders } = useCollection(useMemo(() => remindersQuery(), []));
  const { data: inbox } = useCollection(useMemo(() => inboxQuery(), []));
  const { data: links } = useCollection(useMemo(() => linksQuery(), []));

  const ownerName = user?.displayName?.split(" ")[0] || "Owner";

  const { root, crossEdges } = useMemo(
    () =>
      buildOsTree({
        ownerName,
        projects,
        tasks,
        people,
        reminders,
        links,
        unprocessedInboxCount: inbox.filter((i) => i.status === "unprocessed").length,
        now: new Date(),
      }),
    [ownerName, projects, tasks, people, reminders, links, inbox]
  );

  // Index and parent chain for the whole tree (not just visible nodes), so the
  // detail panel can name any relationship and jumping to one can expand the
  // ancestors that reveal it.
  const { nodeIndex, parentOf } = useMemo(() => {
    const nodeIndex = new Map<string, OsNode>();
    const parentOf = new Map<string, string>();
    const walk = (node: OsNode, parent: string | null) => {
      nodeIndex.set(node.id, node);
      if (parent) parentOf.set(node.id, parent);
      node.children.forEach((c) => walk(c, node.id));
    };
    walk(root, null);
    return { nodeIndex, parentOf };
  }, [root]);

  // null = "untouched": hubs start open, and the camera keeps auto-fitting
  // until the user takes over.
  const [expandedState, setExpanded] = useState<ReadonlySet<string> | null>(null);
  const expanded = useMemo(
    () =>
      expandedState ??
      new Set(["owner", ...root.children.filter((c) => c.children.length).map((c) => c.id)]),
    [expandedState, root]
  );

  const placed = useMemo(() => layoutRadial(root, expanded), [root, expanded]);
  const placedById = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);

  const [transformState, setTransform] = useState<Transform | null>(null);
  const transform = transformState ?? fitTransform(placed, size.width, size.height);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (nodeIndex.get(selectedId) ?? null) : null;

  const visibleArcs = useMemo(
    () =>
      crossEdges
        .map((e) => ({ a: placedById.get(e.a), b: placedById.get(e.b), key: `${e.a}|${e.b}` }))
        .filter((e): e is { a: PlacedNode; b: PlacedNode; key: string } => !!e.a && !!e.b),
    [crossEdges, placedById]
  );

  const relatedIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const set = new Set<string>([selectedId]);
    for (const e of crossEdges) {
      if (e.a === selectedId) set.add(e.b);
      if (e.b === selectedId) set.add(e.a);
    }
    const p = parentOf.get(selectedId);
    if (p) set.add(p);
    nodeIndex.get(selectedId)?.children.forEach((c) => set.add(c.id));
    return set;
  }, [selectedId, crossEdges, parentOf, nodeIndex]);

  /** Selects a node, expanding every ancestor so it is actually on screen. */
  const jumpTo = (id: string) => {
    const next = new Set(expanded);
    let cursor = parentOf.get(id);
    while (cursor) {
      next.add(cursor);
      cursor = parentOf.get(cursor);
    }
    setExpanded(next);
    setSelectedId(id);
  };

  const toggleNode = (node: OsNode) => {
    setSelectedId(node.id);
    if (!node.children.length) return;
    const next = new Set(expanded);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    setExpanded(next);
  };

  // --- pan / pinch / zoom -------------------------------------------------
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number; startX: number; startY: number }>;
    moved: boolean;
    startDistance: number;
    startK: number;
  }>({ pointers: new Map(), moved: false, startDistance: 0, startK: 1 });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    g.pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
    });
    if (g.pointers.size === 1) g.moved = false;
    if (g.pointers.size === 2) {
      const [p1, p2] = [...g.pointers.values()];
      g.startDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      g.startK = transform.k;
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
    const next = { x: e.clientX, y: e.clientY, startX: prev.startX, startY: prev.startY };
    g.pointers.set(e.pointerId, next);

    // A tap survives finger wobble; only real travel from the press point
    // turns the gesture into a pan and suppresses the click.
    if (Math.hypot(next.x - prev.startX, next.y - prev.startY) > TAP_THRESHOLD_PX) {
      g.moved = true;
    }

    if (g.pointers.size === 1) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      if (g.moved && (dx !== 0 || dy !== 0)) {
        setTransform({ ...transform, x: transform.x + dx, y: transform.y + dy });
      }
    } else if (g.pointers.size === 2 && g.startDistance > 0) {
      const [p1, p2] = [...g.pointers.values()];
      const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.startK * distance) / g.startDistance));
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;
      const rect = e.currentTarget.getBoundingClientRect();
      const px = cx - rect.left;
      const py = cy - rect.top;
      setTransform({
        k,
        x: px - ((px - transform.x) / transform.k) * k,
        y: py - ((py - transform.y) / transform.k) * k,
      });
      g.moved = true;
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    gesture.current.pointers.delete(e.pointerId);
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.k * (e.deltaY < 0 ? 1.15 : 0.87)));
    setTransform({
      k,
      x: px - ((px - transform.x) / transform.k) * k,
      y: py - ((py - transform.y) / transform.k) * k,
    });
  };

  const zoomBy = (factor: number) => {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.k * factor));
    const cx = size.width / 2;
    const cy = size.height / 2;
    setTransform({
      k,
      x: cx - ((cx - transform.x) / transform.k) * k,
      y: cy - ((cy - transform.y) / transform.k) * k,
    });
  };

  const isEmpty = root.children.length === 0;

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] flex-col gap-3 md:h-[calc(100dvh-3rem)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Mind View</h1>
          <p className="text-xs text-muted-foreground">
            Your workspace, from the centre out. Tap to expand.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 sm:flex">
            {STATUS_LEGEND.map(({ status, label }) => (
              <span key={status} className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: STATUS_COLOR[status] }}
                />
                {label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
              <Minus className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Fit view"
              onClick={() => {
                setTransform(null);
                setExpanded(null);
              }}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div ref={canvasRef} className="surface relative min-h-0 flex-1 overflow-hidden">
        {projectsLoading ? (
          <div className="flex h-full flex-col gap-3 p-6">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-full w-full" />
          </div>
        ) : isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing to map yet — create a project or text the assistant, and this becomes your
              operating picture.
            </p>
          </div>
        ) : (
          <svg
            className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            onClick={() => {
              if (!gesture.current.moved) setSelectedId(null);
            }}
            role="application"
            aria-label="Workspace graph"
          >
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
              {/* Tree edges */}
              {placed.map((p) => {
                if (!p.parentId) return null;
                const parent = placedById.get(p.parentId);
                if (!parent) return null;
                const highlighted =
                  selectedId !== null && (relatedIds.has(p.node.id) || p.node.id === selectedId);
                return (
                  <line
                    key={`edge-${p.node.id}`}
                    x1={parent.x}
                    y1={parent.y}
                    x2={p.x}
                    y2={p.y}
                    stroke={highlighted ? nodeColor(p.node) : "var(--border)"}
                    strokeWidth={highlighted ? 1.6 : 1}
                    style={{ transition: "all 320ms ease" }}
                  />
                );
              })}

              {/* Cross-relationship arcs */}
              {visibleArcs.map(({ a, b, key }) => {
                const active =
                  selectedId === a.node.id || selectedId === b.node.id;
                return (
                  <path
                    key={key}
                    d={arcPath(a, b)}
                    fill="none"
                    stroke={STATUS_COLOR.green}
                    strokeWidth={active ? 1.8 : 1}
                    strokeDasharray="4 5"
                    opacity={selectedId ? (active ? 0.9 : 0.1) : 0.35}
                    style={{ transition: "all 320ms ease" }}
                  />
                );
              })}

              {/* Nodes */}
              {placed.map((p) => {
                const r = KIND_RADIUS[p.node.kind];
                const color = nodeColor(p.node);
                const dimmed = selectedId !== null && !relatedIds.has(p.node.id);
                const isSelected = selectedId === p.node.id;
                return (
                  <g
                    key={p.node.id}
                    className="animate-fade-in cursor-pointer"
                    style={{
                      transform: `translate(${p.x}px, ${p.y}px)`,
                      transition: "transform 400ms cubic-bezier(0.22, 1, 0.36, 1), opacity 250ms ease",
                      opacity: dimmed ? 0.3 : 1,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!gesture.current.moved) toggleNode(p.node);
                    }}
                  >
                    {/* Finger-sized invisible hit area */}
                    <circle r={Math.max(r + 10, 20)} fill="transparent" />
                    <circle
                      r={r}
                      fill="var(--card)"
                      stroke={color}
                      strokeWidth={isSelected ? 3 : p.node.kind === "owner" ? 2.5 : 2}
                      style={{ filter: dimmed ? undefined : `drop-shadow(0 0 ${isSelected ? 10 : 5}px ${color})` }}
                    />
                    {p.node.kind === "owner" && (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="pointer-events-none fill-primary font-mono"
                        style={{ fontSize: 16, fontWeight: 600 }}
                      >
                        {p.node.label.slice(0, 1).toUpperCase()}
                      </text>
                    )}
                    {/* Collapsed-children badge */}
                    {p.node.children.length > 0 && !p.expanded && p.node.kind !== "owner" && (
                      <g transform={`translate(${r * 0.85}, ${-r * 0.85})`}>
                        <circle r={7.5} fill="var(--secondary)" stroke="var(--border)" />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="pointer-events-none fill-foreground font-mono"
                          style={{ fontSize: 8 }}
                        >
                          {p.node.children.length}
                        </text>
                      </g>
                    )}
                    {/* Alert dot: trouble somewhere beneath this node */}
                    {p.node.alerts > 0 && !p.expanded && (
                      <circle
                        cx={-r * 0.85}
                        cy={-r * 0.85}
                        r={3.5}
                        fill={STATUS_COLOR.red}
                        style={{ filter: `drop-shadow(0 0 4px ${STATUS_COLOR.red})` }}
                      />
                    )}
                    <text
                      y={r + 12}
                      textAnchor="middle"
                      className="pointer-events-none fill-foreground font-mono"
                      style={{
                        fontSize: p.node.kind === "owner" ? 12 : p.node.kind === "hub" ? 10.5 : 9,
                        paintOrder: "stroke",
                        stroke: "var(--background)",
                        strokeWidth: 4,
                        strokeLinejoin: "round",
                      }}
                    >
                      {p.node.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}

        {/* Detail panel */}
        {selected && (
          <div className="surface animate-rise absolute inset-x-3 bottom-3 max-h-[45%] overflow-y-auto p-4 md:inset-x-auto md:right-3 md:top-3 md:bottom-auto md:w-72">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{selected.label}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: nodeColor(selected) }}
                  />
                  {selected.kind} · {selected.sublabel}
                </p>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                aria-label="Close"
                className="tap -m-1 rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {relatedIds.size > 1 && (
              <div className="mt-3 flex flex-col gap-1">
                <p className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
                  Connected to
                </p>
                {[...relatedIds]
                  .filter((id) => id !== selectedId && nodeIndex.has(id))
                  .slice(0, 8)
                  .map((id) => {
                    const node = nodeIndex.get(id)!;
                    return (
                      <button
                        key={id}
                        onClick={() => jumpTo(id)}
                        className={cn(
                          "tap flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                          "hover:bg-accent"
                        )}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: nodeColor(node) }}
                        />
                        <span className="min-w-0 flex-1 truncate">{node.label}</span>
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
              </div>
            )}

            {selected.href && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                nativeButton={false}
                render={<Link href={selected.href}>Open</Link>}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
