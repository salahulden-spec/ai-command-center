"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Minus, Plus, Maximize2, X } from "lucide-react";
import { useCollection } from "@/hooks/use-collection";
import { useProjectSubcollection } from "@/hooks/use-project-subcollection";
import { useElementSize } from "@/hooks/use-element-size";
import { projectsQuery } from "@/lib/firestore/projects";
import { allTasksQuery } from "@/lib/firestore/tasks";
import { peopleQuery } from "@/lib/firestore/people";
import { remindersQuery } from "@/lib/firestore/reminders";
import { buildMindGraph, type MindNode, type MindNodeType } from "@/lib/mind/graph";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Decision, ProjectDocument, ResearchEntry } from "@/types";

type SimNode = MindNode & SimulationNodeDatum;
interface SimLink extends SimulationLinkDatum<SimNode> {
  source: SimNode;
  target: SimNode;
  kind: "belongsTo" | "mentions";
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

const TYPE_META: Record<MindNodeType, { label: string; color: string }> = {
  project: { label: "Projects", color: "var(--chart-1)" },
  task: { label: "Tasks", color: "var(--chart-2)" },
  person: { label: "People", color: "var(--chart-3)" },
  reminder: { label: "Reminders", color: "var(--chart-4)" },
  document: { label: "Documents", color: "var(--chart-5)" },
  research: { label: "Research", color: "var(--chart-6)" },
  decision: { label: "Decisions", color: "var(--chart-7)" },
  unfiled: { label: "Unfiled", color: "var(--muted-foreground)" },
};

const TYPE_ORDER: MindNodeType[] = [
  "project",
  "task",
  "person",
  "reminder",
  "document",
  "research",
  "decision",
  "unfiled",
];

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3.5;
/** Pointer travel (CSS px) before a press on a node counts as a drag, not a tap. */
const DRAG_THRESHOLD_PX = 5;

function radiusFor(node: MindNode): number {
  if (node.type === "project") return 15 + Math.min(node.degree, 12) * 0.9;
  if (node.type === "unfiled") return 14;
  if (node.type === "person") return 9;
  return 7;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Runs the force simulation to a settled state and works out a starting camera
 * that frames the whole graph.
 *
 * This is deliberately a pure function called from `useMemo` rather than an
 * effect: the layout is fully determined by the graph plus the canvas size, so
 * deriving it during render keeps it in sync automatically on resize and avoids
 * a render-then-correct flash.
 */
function computeLayout(
  nodes: MindNode[],
  links: { source: string; target: string; kind: "belongsTo" | "mentions" }[],
  width: number,
  height: number
) {
  const simNodes: SimNode[] = nodes.map((node) => ({ ...node }));
  const simLinks = links.map((link) => ({ ...link }));

  const simulation = forceSimulation<SimNode>(simNodes)
    .force(
      "charge",
      forceManyBody<SimNode>().strength((node) =>
        node.type === "project" || node.type === "unfiled" ? -460 : -150
      )
    )
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(
        simLinks as unknown as SimulationLinkDatum<SimNode>[]
      )
        .id((node) => node.id)
        // "mentions" edges sit looser so cross-links read as bridges between
        // clusters rather than pulling a person inside a project's cluster.
        .distance((link) => ((link as SimLink).kind === "mentions" ? 130 : 82))
        .strength(0.7)
    )
    .force("center", forceCenter(width / 2, height / 2))
    // Padded well beyond the circle: each node carries a caption underneath, and
    // without room for it the labels of neighbouring nodes overlap into mush.
    .force("collide", forceCollide<SimNode>((node) => radiusFor(node) + 30))
    .force("x", forceX<SimNode>(width / 2).strength(0.035))
    .force("y", forceY<SimNode>(height / 2).strength(0.055))
    .stop();

  for (let i = 0; i < 340; i += 1) simulation.tick();

  const initialTransform = fitTransform(simNodes, width, height);
  return { simulation, simNodes, simLinks: simLinks as unknown as SimLink[], initialTransform };
}

function fitTransform(nodes: SimNode[], width: number, height: number): Transform {
  if (nodes.length === 0) return { x: 0, y: 0, k: 1 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const r = radiusFor(node);
    // Captions sit below and extend past the circle on both sides — measuring
    // only the circles would frame the graph with the labels clipped off.
    const halfLabel = Math.max(r, 52);
    minX = Math.min(minX, (node.x ?? 0) - halfLabel);
    maxX = Math.max(maxX, (node.x ?? 0) + halfLabel);
    minY = Math.min(minY, (node.y ?? 0) - r);
    maxY = Math.max(maxY, (node.y ?? 0) + r + 18);
  }

  const padding = 32;
  const graphWidth = Math.max(maxX - minX, 1);
  const graphHeight = Math.max(maxY - minY, 1);
  // Capped well below MAX_ZOOM so a two-node graph doesn't fill the canvas with
  // two enormous circles, but high enough that small graphs don't look lost.
  const k = clamp(
    Math.min((width - padding) / graphWidth, (height - padding) / graphHeight),
    MIN_ZOOM,
    1.15
  );

  return {
    k,
    x: width / 2 - ((minX + maxX) / 2) * k,
    y: height / 2 - ((minY + maxY) / 2) * k,
  };
}

export default function MindViewPage() {
  const { data: projects, loading: loadingProjects } = useCollection(
    useMemo(() => projectsQuery(), [])
  );
  const { data: tasks, loading: loadingTasks } = useCollection(useMemo(() => allTasksQuery(), []));
  const { data: people, loading: loadingPeople } = useCollection(useMemo(() => peopleQuery(), []));
  const { data: reminders, loading: loadingReminders } = useCollection(
    useMemo(() => remindersQuery(), [])
  );
  const { data: documents } = useProjectSubcollection<ProjectDocument>("documents");
  const { data: research } = useProjectSubcollection<ResearchEntry>("research");
  const { data: decisions } = useProjectSubcollection<Decision>("decisions");

  const loading = loadingProjects || loadingTasks || loadingPeople || loadingReminders;

  const [containerRef, { width: measuredWidth }] = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);

  const [hiddenTypes, setHiddenTypes] = useState<Set<MindNodeType>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const width = Math.max(measuredWidth, 280);
  const height = Math.round(clamp(width * 0.72, 380, 640));

  const graph = useMemo(
    () =>
      buildMindGraph({ projects, tasks, people, reminders, documents, research, decisions }),
    [projects, tasks, people, reminders, documents, research, decisions]
  );

  const visible = useMemo(() => {
    if (hiddenTypes.size === 0) return graph;
    const nodes = graph.nodes.filter((node) => !hiddenTypes.has(node.type));
    const keep = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      links: graph.links.filter((link) => keep.has(link.source) && keep.has(link.target)),
    };
  }, [graph, hiddenTypes]);

  /**
   * Identifies "which layout am I looking at". Any change to the graph, the
   * canvas size, or the filters produces a new key, which automatically
   * invalidates the user's dragged node positions and camera below — no effect
   * or manual reset needed.
   */
  const layoutKey = useMemo(
    () =>
      [
        visible.nodes.length,
        visible.links.length,
        width,
        height,
        visible.nodes.map((n) => n.id).join(","),
      ].join("|"),
    [visible, width, height]
  );

  const layout = useMemo(
    () => computeLayout(visible.nodes, visible.links, width, height),
    [visible, width, height]
  );

  const [dragged, setDragged] = useState<{ key: string; nodes: SimNode[] } | null>(null);
  const [camera, setCamera] = useState<{ key: string; transform: Transform } | null>(null);

  const simNodes = dragged?.key === layoutKey ? dragged.nodes : layout.simNodes;
  const transform = camera?.key === layoutKey ? camera.transform : layout.initialTransform;

  const nodeById = useMemo(() => new Map(simNodes.map((n) => [n.id, n])), [simNodes]);

  const neighbours = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set<string>();
    for (const link of layout.simLinks) {
      if (link.source.id === selectedId) ids.add(link.target.id);
      else if (link.target.id === selectedId) ids.add(link.source.id);
    }
    return ids;
  }, [layout.simLinks, selectedId]);

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;

  const setTransform = useCallback(
    (next: Transform) => setCamera({ key: layoutKey, transform: next }),
    [layoutKey]
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const k = clamp(transform.k * factor, MIN_ZOOM, MAX_ZOOM);
      // Keep the canvas centre fixed while zooming with the buttons.
      const cx = width / 2;
      const cy = height / 2;
      setTransform({
        k,
        x: cx - ((cx - transform.x) / transform.k) * k,
        y: cy - ((cy - transform.y) / transform.k) * k,
      });
    },
    [transform, width, height, setTransform]
  );

  // --- Pointer interaction (pan, pinch-zoom, node dragging) --------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const pinchRef = useRef<{ distance: number; k: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  const flushSimulation = useCallback(() => {
    setDragged({ key: layoutKey, nodes: layout.simNodes.map((node) => ({ ...node })) });
  }, [layoutKey, layout.simNodes]);

  const runSimulation = useCallback(() => {
    if (frameRef.current !== null) return;
    const step = () => {
      layout.simulation.tick();
      flushSimulation();
      if (dragRef.current || layout.simulation.alpha() > 0.03) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(step);
  }, [layout.simulation, flushSimulation]);

  const toGraphPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const scale = width / rect.width;
      return {
        x: ((clientX - rect.left) * scale - transform.x) / transform.k,
        y: ((clientY - rect.top) * scale - transform.y) / transform.k,
      };
    },
    [transform, width]
  );

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>, nodeId?: string) => {
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), k: transform.k };
      panRef.current = null;
      dragRef.current = null;
      return;
    }

    if (nodeId) {
      // Nothing is pinned yet — a press only becomes a drag once it passes the
      // threshold in pointermove, so a plain tap stays a tap.
      dragRef.current = { id: nodeId, startX: event.clientX, startY: event.clientY, moved: false };
      return;
    }

    panRef.current = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y };
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const k = clamp(
        (pinchRef.current.k * distance) / Math.max(pinchRef.current.distance, 1),
        MIN_ZOOM,
        MAX_ZOOM
      );
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scale = width / rect.width;
      const cx = ((a.x + b.x) / 2 - rect.left) * scale;
      const cy = ((a.y + b.y) / 2 - rect.top) * scale;
      setTransform({
        k,
        x: cx - ((cx - transform.x) / transform.k) * k,
        y: cy - ((cy - transform.y) / transform.k) * k,
      });
      return;
    }

    if (dragRef.current) {
      const drag = dragRef.current;
      // Pointers jitter by a pixel or two on any real tap (and CDP-driven
      // clicks emit a move too). Only treat it as a drag past this threshold,
      // otherwise every tap would be swallowed as a no-op drag.
      if (!drag.moved) {
        const travelled = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (travelled < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        layout.simulation.alpha(0.35);
      }
      const point = toGraphPoint(event.clientX, event.clientY);
      const node = layout.simNodes.find((n) => n.id === drag.id);
      if (node) {
        node.fx = point.x;
        node.fy = point.y;
        layout.simulation.alpha(Math.max(layout.simulation.alpha(), 0.2));
        runSimulation();
      }
      return;
    }

    if (panRef.current) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const scale = width / rect.width;
      setTransform({
        k: transform.k,
        x: panRef.current.tx + (event.clientX - panRef.current.x) * scale,
        y: panRef.current.ty + (event.clientY - panRef.current.y) * scale,
      });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;

    if (dragRef.current) {
      const drag = dragRef.current;
      dragRef.current = null;

      if (drag.moved) {
        // Unpin so the node settles back into the simulation.
        const node = layout.simNodes.find((n) => n.id === drag.id);
        if (node) {
          node.fx = null;
          node.fy = null;
        }
        layout.simulation.alpha(0.15);
        runSimulation();
      } else {
        // A press that never travelled is a tap: select instead of navigating,
        // so a stray touch can't yank you off the page.
        setSelectedId((current) => (current === drag.id ? null : drag.id));
      }
    }
    panRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scale = width / rect.width;
    const px = (event.clientX - rect.left) * scale;
    const py = (event.clientY - rect.top) * scale;
    const k = clamp(transform.k * (event.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_ZOOM, MAX_ZOOM);
    setTransform({
      k,
      x: px - ((px - transform.x) / transform.k) * k,
      y: py - ((py - transform.y) / transform.k) * k,
    });
  };

  const toggleType = (type: MindNodeType) => {
    setSelectedId(null);
    setHiddenTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const counts = useMemo(() => {
    const map = new Map<MindNodeType, number>();
    for (const node of graph.nodes) map.set(node.type, (map.get(node.type) ?? 0) + 1);
    return map;
  }, [graph.nodes]);

  const isDimmed = (nodeId: string) =>
    Boolean(selectedId) && nodeId !== selectedId && !neighbours?.has(nodeId);

  const showLabelFor = (node: SimNode) => {
    if (selectedId) return node.id === selectedId || Boolean(neighbours?.has(node.id));
    if (node.type === "project" || node.type === "unfiled") return true;
    return transform.k >= 0.95 && simNodes.length <= 60;
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Mind View</h1>
        <p className="text-sm text-muted-foreground">
          Everything you&apos;ve captured, linked by the relationships that actually exist between
          the records.
        </p>
        <p className="font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
          {graph.nodes.length} nodes · {graph.links.length} connections
        </p>
      </div>

      {graph.nodes.length === 0 ? (
        <div className="glow-border flex flex-col items-center gap-2 rounded-lg border bg-card/30 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">Nothing to map yet.</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Create a project or a task and it&apos;ll appear here, wired up to everything it
            touches.
          </p>
          <Button render={<Link href="/projects">Go to Projects</Link>} size="sm" className="mt-2" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {TYPE_ORDER.filter((type) => (counts.get(type) ?? 0) > 0).map((type) => {
              const hidden = hiddenTypes.has(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  aria-pressed={!hidden}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-widest transition-colors",
                    hidden
                      ? "border-border/60 text-muted-foreground/50"
                      : "border-border bg-card/60 text-foreground"
                  )}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full transition-opacity"
                    style={{
                      backgroundColor: TYPE_META[type].color,
                      opacity: hidden ? 0.3 : 1,
                    }}
                  />
                  {TYPE_META[type].label}
                  <span className="text-muted-foreground">{counts.get(type)}</span>
                </button>
              );
            })}
          </div>

          <div ref={containerRef} className="relative w-full">
            <div className="glow-border bg-grid overflow-hidden rounded-lg border bg-card/30">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${width} ${height}`}
                className="w-full cursor-grab touch-none select-none active:cursor-grabbing"
                style={{ height }}
                role="img"
                aria-label={`Relationship graph with ${simNodes.length} nodes. Use the list below the graph to open records.`}
                onPointerDown={(event) => handlePointerDown(event)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onWheel={handleWheel}
              >
                <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
                  <g>
                    {layout.simLinks.map((link, index) => {
                      const dim =
                        Boolean(selectedId) &&
                        link.source.id !== selectedId &&
                        link.target.id !== selectedId;
                      return (
                        <line
                          key={index}
                          x1={link.source.x}
                          y1={link.source.y}
                          x2={link.target.x}
                          y2={link.target.y}
                          stroke={
                            link.kind === "mentions" ? "var(--chart-3)" : "var(--muted-foreground)"
                          }
                          strokeWidth={link.kind === "mentions" ? 1.4 : 1}
                          strokeDasharray={link.kind === "mentions" ? "4 3" : undefined}
                          opacity={dim ? 0.05 : selectedId ? 0.85 : 0.3}
                        />
                      );
                    })}
                  </g>

                  <g>
                    {simNodes.map((node) => {
                      const radius = radiusFor(node);
                      const dimmed = isDimmed(node.id);
                      const selected = node.id === selectedId;
                      const color = TYPE_META[node.type].color;
                      return (
                        <g
                          key={node.id}
                          transform={`translate(${node.x ?? 0},${node.y ?? 0})`}
                          opacity={dimmed ? 0.18 : 1}
                          className="cursor-pointer"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            handlePointerDown(
                              event as unknown as React.PointerEvent<SVGSVGElement>,
                              node.id
                            );
                          }}
                        >
                          {/* Invisible, finger-sized hit area so small nodes stay tappable. */}
                          <circle r={Math.max(radius + 10, 18)} fill="transparent" />
                          <circle
                            r={radius}
                            fill="var(--card)"
                            stroke={color}
                            strokeWidth={selected ? 3 : 2}
                            style={{
                              filter: dimmed
                                ? undefined
                                : `drop-shadow(0 0 ${selected ? 10 : 5}px ${color})`,
                            }}
                          />
                          {showLabelFor(node) && (
                            <text
                              y={radius + 13}
                              textAnchor="middle"
                              className="pointer-events-none fill-foreground font-mono"
                              style={{
                                fontSize: node.type === "project" ? 11 : 9.5,
                                paintOrder: "stroke",
                                stroke: "var(--background)",
                                strokeWidth: 3,
                                strokeLinejoin: "round",
                              }}
                            >
                              {node.label.length > 22
                                ? `${node.label.slice(0, 21)}…`
                                : node.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                </g>
              </svg>

              <div className="absolute right-3 top-3 flex flex-col gap-1.5">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 bg-card/80 backdrop-blur-sm"
                  onClick={() => zoomBy(1.25)}
                  aria-label="Zoom in"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 bg-card/80 backdrop-blur-sm"
                  onClick={() => zoomBy(1 / 1.25)}
                  aria-label="Zoom out"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 bg-card/80 backdrop-blur-sm"
                  onClick={() => {
                    setCamera(null);
                    setDragged(null);
                    setSelectedId(null);
                  }}
                  aria-label="Reset view"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
              Tap a node to inspect · drag to rearrange · pinch or scroll to zoom
            </p>
          </div>

          {selectedNode && (
            <div className="glow-border flex flex-col gap-3 rounded-lg border bg-card/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: TYPE_META[selectedNode.type].color }}
                    />
                    <span className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
                      {TYPE_META[selectedNode.type].label.replace(/s$/, "")} · {selectedNode.meta}
                    </span>
                  </div>
                  <p className="truncate text-sm font-medium">{selectedNode.label}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {selectedNode.type !== "unfiled" && (
                    <Button size="sm" variant="outline" render={<Link href={selectedNode.href}>Open</Link>} />
                  )}
                  <button
                    onClick={() => setSelectedId(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Clear selection"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground">
                  Connected to ({neighbours?.size ?? 0})
                </p>
                {neighbours && neighbours.size > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {[...neighbours].map((id) => {
                      const node = nodeById.get(id);
                      if (!node) return null;
                      return (
                        <button
                          key={id}
                          onClick={() => setSelectedId(id)}
                          className="flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs transition-colors hover:border-primary/60"
                        >
                          <span
                            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: TYPE_META[node.type].color }}
                          />
                          <span className="truncate">{node.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing links here yet. Attach it to a project, or mention it in a document, to
                    wire it into the graph.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
