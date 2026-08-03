"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Flame, Minus, Plus, Maximize2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useElementSize } from "@/hooks/use-element-size";
import { projectsQuery } from "@/lib/firestore/projects";
import { allTasksQuery } from "@/lib/firestore/tasks";
import { peopleQuery } from "@/lib/firestore/people";
import { remindersQuery } from "@/lib/firestore/reminders";
import { inboxQuery } from "@/lib/firestore/inbox";
import { linksQuery } from "@/lib/firestore/links";
import { buildSuggestions } from "@/lib/insights/suggestions";
import {
  buildOsTree,
  layoutRadial,
  type OsNode,
  type OsStatus,
  type PlacedNode,
  type Prediction,
} from "@/lib/mind/os-graph";
import { Button } from "@/components/ui/button";
import { NodeDetail } from "@/components/mind/node-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Mind View: the workspace as a navigable universe, not a mind map.
 *
 * The owner sits at the centre; categories, records, and a project's own tasks
 * radiate outward with progressive disclosure. The camera is part of the
 * experience: diving into a node glides the viewport there (breadcrumbs lead
 * back), selection focuses a lens that fades everything unrelated, and every
 * node carries liveness — heat, alerts, AI-predicted ghosts. The layout stays
 * a deterministic radial tree (os-graph.ts): nothing jiggles, nothing crosses,
 * and every Firestore change re-derives the picture live.
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

const KIND_RADIUS = {
  owner: 30,
  hub: 20,
  project: 16,
  person: 12,
  task: 11,
  reminder: 11,
  cluster: 14,
  ghost: 11,
} as const;

/** Width the desktop inspector occupies, so the camera can keep clear of it. */
const PANEL_W = 340;
/** Below this the inspector is a bottom sheet instead of a right rail. */
const DESKTOP_MIN = 768;
/** Selecting never leaves the graph smaller than this — captions must stay legible. */
const READABLE_ZOOM = 0.9;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
/** Pointer travel (CSS px) before a press counts as a pan, not a tap. */
const TAP_THRESHOLD_PX = 6;
/** Camera glide duration. Long enough to read as motion, short enough to obey. */
const CAMERA_MS = 650;

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
  return Math.max(node.label.length * 7, 44);
}

function fitTransform(
  placed: PlacedNode[],
  width: number,
  height: number,
  maxK = MAX_ZOOM
): Transform {
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
    maxY = Math.max(maxY, p.y + KIND_RADIUS[p.node.kind] + 22 + p.labelTier * 12);
  }
  const k = Math.min(
    maxK,
    Math.max(MIN_ZOOM, Math.min(width / (maxX - minX + 80), height / (maxY - minY + 80)))
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

  // The suggestions engine doubles as the prediction source: project-scoped
  // advice materialises as ghost nodes the owner can see in context.
  const predictions = useMemo<Prediction[]>(() => {
    const suggestions = buildSuggestions({
      projects,
      tasks,
      reminders,
      people,
      inbox,
      now: new Date(),
    });
    return suggestions
      .filter((s) => s.id.startsWith("no-next-step-") || s.id.startsWith("stale-project-"))
      .map((s) => ({
        projectId: s.id.replace(/^(no-next-step-|stale-project-)/, ""),
        label: s.id.startsWith("no-next-step-") ? "Define next step" : "Revive this project",
        reason: s.text,
        href: s.href,
      }));
  }, [projects, tasks, reminders, people, inbox]);

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
        predictions,
      }),
    [ownerName, projects, tasks, people, reminders, links, inbox, predictions]
  );

  // Index and parent chain for the whole tree (not just visible nodes), so the
  // detail panel can name any relationship, breadcrumbs can walk upward, and
  // jumping to a node can expand the ancestors that reveal it.
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

  const [focusId, setFocusId] = useState("owner");
  const [heatMode, setHeatMode] = useState(false);

  /** Everything inside the focused subtree; the lens fades the rest. */
  const focusSet = useMemo(() => {
    const set = new Set<string>();
    const start = nodeIndex.get(focusId);
    if (!start) return set;
    const walk = (n: OsNode) => {
      set.add(n.id);
      n.children.forEach(walk);
    };
    walk(start);
    return set;
  }, [focusId, nodeIndex]);

  const breadcrumbs = useMemo(() => {
    const path: OsNode[] = [];
    let cursor: string | undefined = focusId;
    while (cursor) {
      const node = nodeIndex.get(cursor);
      if (!node) break;
      path.unshift(node);
      cursor = parentOf.get(cursor);
    }
    return path;
  }, [focusId, nodeIndex, parentOf]);

  const visibleArcs = useMemo(
    () =>
      crossEdges
        .map((e) => ({
          a: placedById.get(e.a),
          b: placedById.get(e.b),
          recent: e.recent,
          key: `${e.a}|${e.b}`,
        }))
        .filter(
          (e): e is { a: PlacedNode; b: PlacedNode; recent: boolean; key: string } => !!e.a && !!e.b
        ),
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

  // --- cinematic camera --------------------------------------------------
  const rafRef = useRef<number | null>(null);
  const stopCamera = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };

  // Always drives setTransform through animation frames — never synchronously —
  // so it is safe to call from effects (react-hooks/set-state-in-effect) and
  // the camera can be cancelled mid-flight by any user gesture.
  const animateTo = (from: Transform, to: Transform) => {
    stopCamera();
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      rafRef.current = requestAnimationFrame(() => setTransform(to));
      return;
    }
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / CAMERA_MS);
      const e = ease(t);
      setTransform({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        k: from.k + (to.k - from.k) * e,
      });
      rafRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const lastFocusRef = useRef(focusId);

  /**
   * The camera responds to two different intents, and conflating them is what
   * made clicking feel dead: a *dive* reframes a whole subtree, while a plain
   * *selection* should bring that one node into the clear and hold it there.
   *
   * Selection also has to dodge the inspector — on desktop it covers the right
   * ~340px, on mobile the bottom ~60%. Centring in the full canvas would drop
   * the node you just picked underneath the panel describing it.
   *
   * Deliberately NOT keyed on layout/transform: data updates must never yank
   * the camera while the owner is reading.
   */
  useEffect(() => {
    if (!size.width || !size.height) return;

    const focusChanged = lastFocusRef.current !== focusId;
    lastFocusRef.current = focusId;

    if (focusChanged) {
      const subset = placed.filter((p) => focusSet.has(p.node.id));
      if (!subset.length) return;
      animateTo(
        transform,
        fitTransform(subset, size.width, size.height, focusId === "owner" ? MAX_ZOOM : 1.6)
      );
      return;
    }

    if (!selectedId) return;
    const target = placedById.get(selectedId);
    if (!target) return;

    const desktop = size.width >= DESKTOP_MIN;
    const clearWidth = desktop ? size.width - PANEL_W : size.width;
    // On mobile the sheet owns the lower ~62%, so aim high in what's left.
    const clearCentreY = desktop ? size.height / 2 : size.height * 0.19;
    const k = Math.max(transform.k, READABLE_ZOOM);

    animateTo(transform, {
      k,
      x: clearWidth / 2 - target.x * k,
      y: clearCentreY - target.y * k,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- camera moves only on focus/selection/resize, never on data churn
  }, [focusId, selectedId, size.width, size.height]);

  useEffect(() => stopCamera, []);

  /**
   * Only the cross-link relationships, for the inspector's "Connected to".
   * `relatedIds` above also carries parent and children — those are structure
   * the panel already shows under "Contains", and repeating them there would
   * read as noise rather than as relationships.
   */
  const crossRelatedIds = useMemo(() => {
    if (!selectedId) return [];
    const ids: string[] = [];
    for (const e of crossEdges) {
      if (e.a === selectedId && nodeIndex.has(e.b)) ids.push(e.b);
      else if (e.b === selectedId && nodeIndex.has(e.a)) ids.push(e.a);
    }
    return ids;
  }, [selectedId, crossEdges, nodeIndex]);

  /**
   * Follow a reference from the inspector. Reveals the target by expanding its
   * ancestors and selects it, but only moves the camera when it isn't already
   * on screen — flying on every click would make reading a task list feel like
   * being dragged around.
   */
  const goTo = (id: string) => {
    const alreadyVisible = placedById.has(id);
    const next = new Set(expanded);
    let cursor = parentOf.get(id);
    while (cursor) {
      next.add(cursor);
      cursor = parentOf.get(cursor);
    }
    setExpanded(next);
    setSelectedId(id);
    if (!alreadyVisible) setFocusId(parentOf.get(id) ?? id);
  };

  /** Dive: focus a node, expand the path to it, and glide the camera there. */
  const dive = (id: string) => {
    const next = new Set(expanded);
    next.add(id);
    let cursor = parentOf.get(id);
    while (cursor) {
      next.add(cursor);
      cursor = parentOf.get(cursor);
    }
    setExpanded(next);
    setSelectedId(id === "owner" ? null : id);
    setFocusId(id);
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
    stopCamera();
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
    stopCamera();
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
    stopCamera();
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transform.k * factor));
    const cx = size.width / 2;
    const cy = size.height / 2;
    setTransform({
      k,
      x: cx - ((cx - transform.x) / transform.k) * k,
      y: cy - ((cy - transform.y) / transform.k) * k,
    });
  };

  const openTaskCount = tasks.filter((t) => t.status !== "done").length;
  const blockedCount = tasks.filter((t) => t.status === "blocked").length;
  const objectCount =
    projects.length + openTaskCount + people.length +
    reminders.filter((r) => r.status === "pending").length;

  const isEmpty = root.children.length === 0;
  const focused = focusId !== "owner";

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] flex-col gap-2 md:h-[calc(100dvh-3rem)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Mind View</h1>
          {/* Graph health, live. */}
          <p className="font-mono text-[0.65rem] text-muted-foreground">
            {objectCount} objects · {openTaskCount} open · {blockedCount} blocked ·{" "}
            {root.alerts > 0 ? (
              <span className="text-destructive">{root.alerts} urgent</span>
            ) : (
              "all clear"
            )}
            {predictions.length > 0 && ` · ${predictions.length} AI suggestions`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 lg:flex">
            {STATUS_LEGEND.map(({ status, label }) => (
              <span
                key={status}
                className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: STATUS_COLOR[status] }}
                />
                {label}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant={heatMode ? "default" : "outline"}
              size="icon"
              aria-label="Activity heatmap"
              title="Activity heatmap — bright is recent, dark is idle"
              onClick={() => setHeatMode((v) => !v)}
            >
              <Flame className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
              <Minus className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Reset view"
              onClick={() => {
                setExpanded(null);
                setSelectedId(null);
                dive("owner");
                setTransform(null);
              }}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Breadcrumbs: where the camera lives. Every crumb glides back. */}
      <nav aria-label="Graph path" className="no-scrollbar flex items-center gap-1 overflow-x-auto">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.id} className="flex shrink-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/60" />}
            <button
              onClick={() => dive(crumb.id)}
              className={cn(
                "tap rounded-md px-2 py-1 font-mono text-[0.7rem]",
                i === breadcrumbs.length - 1
                  ? "glow-text text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      <div ref={canvasRef} className="surface relative min-h-0 flex-1 overflow-hidden">
        {/* Parallax field: the grid drifts at a quarter of camera speed, which
            is what makes zooming feel like moving through space, not scaling a
            drawing. */}
        <div
          aria-hidden
          className="bg-grid pointer-events-none absolute -inset-[150%] opacity-40"
          style={{ transform: `translate(${transform.x * 0.25}px, ${transform.y * 0.25}px)` }}
        />

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
            className="relative h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
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
              {/* Tree edges — weight carries trouble: paths to alerts run heavier. */}
              {placed.map((p) => {
                if (!p.parentId) return null;
                const parent = placedById.get(p.parentId);
                if (!parent) return null;
                const inFocus = !focused || (focusSet.has(p.node.id) && focusSet.has(p.parentId));
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
                    strokeWidth={highlighted ? 1.6 : 1 + Math.min(p.node.alerts, 3) * 0.35}
                    opacity={inFocus ? 1 : 0.06}
                    style={{ transition: "all 320ms ease" }}
                  />
                );
              })}

              {/* Cross-relationship arcs — recent ones flow. */}
              {visibleArcs.map(({ a, b, recent, key }) => {
                const inFocus =
                  !focused || (focusSet.has(a.node.id) && focusSet.has(b.node.id));
                const active = selectedId === a.node.id || selectedId === b.node.id;
                return (
                  <path
                    key={key}
                    d={arcPath(a, b)}
                    fill="none"
                    className={recent ? "arc-recent" : undefined}
                    stroke={STATUS_COLOR.green}
                    strokeWidth={active ? 1.8 : recent ? 1.4 : 1}
                    strokeDasharray="4 5"
                    opacity={!inFocus ? 0.03 : selectedId ? (active ? 0.9 : 0.1) : recent ? 0.55 : 0.3}
                    style={{ transition: "opacity 320ms ease" }}
                  />
                );
              })}

              {/* Nodes */}
              {placed.map((p) => {
                const r = KIND_RADIUS[p.node.kind];
                const color = nodeColor(p.node);
                const inFocus = !focused || focusSet.has(p.node.id);
                const dimmed = selectedId !== null && !relatedIds.has(p.node.id);
                const isSelected = selectedId === p.node.id;
                const isGhost = p.node.kind === "ghost";
                const opacity = !inFocus
                  ? 0.08
                  : heatMode
                    ? 0.25 + 0.75 * p.node.heat
                    : dimmed
                      ? 0.3
                      : isGhost
                        ? 0.65
                        : 1;
                const showAlertPulse = p.node.alerts > 0 && !p.expanded && inFocus && !heatMode;
                // "Just happened" only — heat 0.994 is roughly the last two
                // hours. Any looser and a busy day makes every node shimmer,
                // and a universe where everything pulses says nothing.
                const showHeatPulse =
                  p.node.heat > 0.994 && p.node.kind !== "owner" && inFocus && !isGhost;
                return (
                  <g
                    key={p.node.id}
                    className="animate-fade-in cursor-pointer"
                    style={{
                      transform: `translate(${p.x}px, ${p.y}px)`,
                      transition:
                        "transform 400ms cubic-bezier(0.22, 1, 0.36, 1), opacity 250ms ease, filter 250ms ease",
                      opacity,
                      // Spatial depth: outside the focus lens things sit on a
                      // farther plane — softly blurred, not just faded.
                      filter: !inFocus ? "blur(1.5px)" : undefined,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!gesture.current.moved) toggleNode(p.node);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      dive(p.node.id);
                    }}
                  >
                    {/* Finger-sized invisible hit area */}
                    <circle r={Math.max(r + 10, 20)} fill="transparent" />

                    {/* Cluster stacks read as a pile of cards. */}
                    {p.node.kind === "cluster" && (
                      <>
                        <circle cx={6} cy={6} r={r} fill="var(--card)" stroke={color} strokeWidth={1} opacity={0.35} />
                        <circle cx={3} cy={3} r={r} fill="var(--card)" stroke={color} strokeWidth={1.4} opacity={0.6} />
                      </>
                    )}

                    {(showAlertPulse || showHeatPulse) && (
                      <circle
                        className="pulse-ring"
                        r={r + 3}
                        fill="none"
                        stroke={showAlertPulse ? STATUS_COLOR.red : color}
                        strokeWidth={1.5}
                      />
                    )}

                    <circle
                      r={r}
                      fill={isGhost ? "transparent" : "var(--card)"}
                      stroke={color}
                      strokeWidth={isSelected ? 3 : p.node.kind === "owner" ? 2.5 : 2}
                      strokeDasharray={isGhost ? "4 4" : undefined}
                      style={{
                        filter:
                          dimmed || isGhost
                            ? undefined
                            : `drop-shadow(0 0 ${
                                heatMode ? 3 + p.node.heat * 12 : isSelected ? 10 : 5
                              }px ${color})`,
                      }}
                    />
                    {p.node.kind === "owner" && (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="pointer-events-none fill-primary font-mono"
                        style={{ fontSize: 15, fontWeight: 600 }}
                      >
                        {p.node.label.slice(0, 1).toUpperCase()}
                      </text>
                    )}
                    {/* Collapsed-children badge */}
                    {p.node.children.length > 0 &&
                      !p.expanded &&
                      p.node.kind !== "owner" &&
                      p.node.kind !== "cluster" && (
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
                    <text
                      y={r + 12 + p.labelTier * 12}
                      textAnchor="middle"
                      className="pointer-events-none fill-foreground font-mono"
                      style={{
                        fontSize: p.node.kind === "owner" ? 14 : p.node.kind === "hub" ? 12.5 : 11,
                        fontStyle: isGhost ? "italic" : undefined,
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

        {selected && (
          <NodeDetail
            node={selected}
            records={{ projects, tasks, people, reminders }}
            relatedIds={crossRelatedIds}
            nodeIndex={nodeIndex}
            onSelect={goTo}
            onFocus={() => dive(selected.id)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
