"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from "d3-force";
import { useCollection } from "@/hooks/use-collection";
import { projectsQuery } from "@/lib/firestore/projects";
import { allTasksQuery } from "@/lib/firestore/tasks";
import { peopleQuery } from "@/lib/firestore/people";
import { remindersQuery } from "@/lib/firestore/reminders";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type NodeType = "project" | "task" | "person" | "reminder";

interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  href?: string;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
}

const NODE_STYLE: Record<NodeType, { radius: number; color: string }> = {
  project: { radius: 16, color: "var(--chart-1)" },
  task: { radius: 7, color: "var(--chart-2)" },
  person: { radius: 9, color: "var(--chart-3)" },
  reminder: { radius: 8, color: "var(--chart-4)" },
};

const WIDTH = 1000;
const HEIGHT = 640;

export default function MindViewPage() {
  const router = useRouter();
  const { data: projects, loading: loadingProjects } = useCollection(projectsQuery());
  const { data: tasks, loading: loadingTasks } = useCollection(allTasksQuery());
  const { data: people, loading: loadingPeople } = useCollection(peopleQuery());
  const { data: reminders, loading: loadingReminders } = useCollection(remindersQuery());

  const loading = loadingProjects || loadingTasks || loadingPeople || loadingReminders;

  const { nodes: rawNodes, links } = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    for (const project of projects) {
      nodes.push({ id: `project-${project.id}`, type: "project", label: project.name, href: `/projects/${project.id}` });
    }
    for (const task of tasks) {
      const nodeId = `task-${task.id}`;
      nodes.push({
        id: nodeId,
        type: "task",
        label: task.title,
        href: task.projectId ? `/projects/${task.projectId}` : "/projects",
      });
      if (task.projectId) {
        links.push({ source: nodeId, target: `project-${task.projectId}` });
      }
    }
    for (const person of people) {
      nodes.push({ id: `person-${person.id}`, type: "person", label: person.name, href: "/people" });
    }
    for (const reminder of reminders) {
      const nodeId = `reminder-${reminder.id}`;
      nodes.push({ id: nodeId, type: "reminder", label: reminder.text, href: "/reminders" });
      if (reminder.relatedProjectId) {
        links.push({ source: nodeId, target: `project-${reminder.relatedProjectId}` });
      }
    }

    return { nodes, links };
  }, [projects, tasks, people, reminders]);

  const [positioned, setPositioned] = useState<GraphNode[]>([]);

  useEffect(() => {
    if (rawNodes.length === 0) {
      setPositioned([]);
      return;
    }
    const simNodes = rawNodes.map((n) => ({ ...n }));
    const sim = forceSimulation(simNodes)
      .force("charge", forceManyBody().strength(-140))
      .force(
        "link",
        forceLink(links).id((d) => (d as GraphNode).id).distance(70)
      )
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
      .force(
        "collide",
        forceCollide((d) => NODE_STYLE[(d as GraphNode).type].radius + 24)
      )
      .stop();

    for (let i = 0; i < 300; i++) sim.tick();
    setPositioned(simNodes as GraphNode[]);
  }, [rawNodes, links]);

  if (loading) {
    return <Skeleton className="h-[640px] w-full" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Mind View</h1>
        <p className="text-sm text-muted-foreground">
          Every project, task, person, and reminder — connected by what actually links them.
        </p>
      </div>

      {positioned.length === 0 ? (
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Nothing to map yet — add a project or task first.
        </p>
      ) : (
        <div className="glow-border overflow-hidden rounded-lg border bg-card/30">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-[640px] w-full">
            <g>
              {links.map((link, i) => {
                const source = positioned.find((n) => n.id === link.source);
                const target = positioned.find((n) => n.id === link.target);
                if (!source || !target) return null;
                return (
                  <line
                    key={i}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                );
              })}
            </g>
            <g>
              {positioned.map((node) => {
                const style = NODE_STYLE[node.type];
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x},${node.y})`}
                    className={cn(node.href && "cursor-pointer")}
                    onClick={() => node.href && router.push(node.href)}
                  >
                    <circle
                      r={style.radius}
                      fill="var(--card)"
                      stroke={style.color}
                      strokeWidth={2}
                      style={{ filter: `drop-shadow(0 0 6px ${style.color})` }}
                    />
                    <text
                      y={style.radius + 14}
                      textAnchor="middle"
                      className="fill-muted-foreground font-mono"
                      style={{ fontSize: 10 }}
                    >
                      {node.label.length > 20 ? `${node.label.slice(0, 20)}…` : node.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}

      <div className="flex flex-wrap gap-4 font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground">
        {(Object.keys(NODE_STYLE) as NodeType[]).map((type) => (
          <span key={type} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: NODE_STYLE[type].color }}
            />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
