import type { EntityLink, Person, Project, Reminder, Task } from "@/types";

/**
 * The Mind View's model: a radial universe with the owner at the centre and
 * progressive disclosure outward — categories, then records, then a project's
 * own tasks. A tree (rather than a force layout) is a deliberate choice: it
 * cannot produce crossing edges, it is deterministic so nothing jiggles on
 * refresh, and collapsed depth is what keeps a workspace of hundreds of
 * records readable. Cross-relationships (a person involved in a task) are not
 * tree edges; they are drawn as separate arcs between visible nodes.
 *
 * Beyond structure, every node carries *liveness*: a heat score (how recently
 * it moved), alert counts that bubble trouble upward through collapsed
 * layers, and — for projects the suggestions engine is worried about — ghost
 * children that represent what the AI thinks should exist next.
 */

export type OsNodeKind =
  | "owner"
  | "hub"
  | "project"
  | "person"
  | "task"
  | "reminder"
  | "cluster"
  | "ghost";

/** Traffic-light language shared by every node: what state is this thing in? */
export type OsStatus = "green" | "blue" | "orange" | "red" | "gray" | "neutral";

export interface OsNode {
  id: string;
  kind: OsNodeKind;
  label: string;
  sublabel: string;
  status: OsStatus;
  href: string | null;
  children: OsNode[];
  /** Descendants needing attention (red) — surfaces trouble through collapsed layers. */
  alerts: number;
  /** 0..1 recency of activity — drives the heatmap and the "alive" pulses. */
  heat: number;
  /** Longer explanation shown in the detail panel (ghosts carry their reasoning here). */
  detail?: string;
}

export interface PlacedNode {
  node: OsNode;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
  /** Whether this node currently shows its children. */
  expanded: boolean;
  /**
   * Which caption baseline this node uses (0 or 1). Adjacent siblings on an
   * outer ring sit close enough that their captions collide side by side;
   * alternating them onto two baselines separates neighbours without moving
   * the nodes themselves.
   */
  labelTier: number;
}

export interface CrossEdge {
  a: string;
  b: string;
  /** Created within the last two days — recent relationships pulse. */
  recent: boolean;
}

/** An AI-suggested ghost: what the assistant thinks a project is missing. */
export interface Prediction {
  projectId: string;
  label: string;
  reason: string;
  href: string;
}

export interface OsGraphInput {
  ownerName: string;
  projects: Project[];
  tasks: Task[];
  people: Person[];
  reminders: Reminder[];
  links: EntityLink[];
  unprocessedInboxCount: number;
  now: Date;
  predictions?: Prediction[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_LINK_MS = 2 * DAY_MS;
/** Past this many children, the rest fold into a "+N more" cluster. */
export const CLUSTER_THRESHOLD = 10;
const CLUSTER_KEEP = 8;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word name match — "Ali" must not light up on "quality". */
export function textMentionsPerson(text: string, personName: string): boolean {
  const name = normalize(personName);
  if (name.length < 3) return false;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}([^\\p{L}\\p{N}]|$)`, "u");
  return pattern.test(normalize(text));
}

function truncate(value: string, max = 26): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function isOverdue(due: { toMillis(): number } | null | undefined, now: Date): boolean {
  return !!due && due.toMillis() < now.getTime();
}

/** 1 for touched-just-now, fading to 0 over two weeks of silence. */
export function heatOf(
  timestamp: { toMillis(): number } | null | undefined,
  now: Date
): number {
  if (!timestamp) return 0;
  const age = now.getTime() - timestamp.toMillis();
  if (age <= 0) return 1;
  return Math.max(0, 1 - age / (14 * DAY_MS));
}

function taskStatus(task: Task, now: Date): OsStatus {
  if (isOverdue(task.dueDate, now) || task.priority === "high") return "red";
  if (task.status === "blocked") return "orange";
  if (task.status === "doing") return "blue";
  return "neutral";
}

function projectStatus(project: Project): OsStatus {
  if (project.status === "done") return "green";
  if (project.status === "paused" || project.status === "blocked") return "orange";
  if (project.status === "archived") return "gray";
  return "blue";
}

const taskNode = (task: Task, now: Date): OsNode => ({
  id: `task-${task.id}`,
  kind: "task",
  label: truncate(task.title),
  sublabel: task.status + (isOverdue(task.dueDate, now) ? " · overdue" : ""),
  status: taskStatus(task, now),
  href: task.projectId ? `/projects/${task.projectId}` : "/tasks",
  children: [],
  alerts: 0,
  heat: heatOf(task.updatedAt ?? task.createdAt, now),
});

/**
 * Folds an oversized sibling row into "top few + a cluster of the rest", so a
 * hub with 84 tasks reads as a handful of important ones plus "+76 more"
 * instead of an unreadable fan. The kept few are whatever most deserves the
 * owner's eye: red first, then warmest.
 */
export function clusterChildren(children: OsNode[], parentId: string): OsNode[] {
  if (children.length <= CLUSTER_THRESHOLD) return children;
  const ranked = [...children].sort((a, b) => {
    const redDiff = (b.status === "red" ? 1 : 0) - (a.status === "red" ? 1 : 0);
    if (redDiff) return redDiff;
    const alertDiff = b.alerts - a.alerts;
    if (alertDiff) return alertDiff;
    return b.heat - a.heat;
  });
  const kept = ranked.slice(0, CLUSTER_KEEP);
  const rest = ranked.slice(CLUSTER_KEEP);
  kept.push({
    id: `${parentId}-more`,
    kind: "cluster",
    label: `+${rest.length} more`,
    sublabel: `${rest.length} collapsed`,
    status: "neutral",
    href: null,
    children: rest,
    alerts: rest.reduce((sum, c) => sum + c.alerts + (c.status === "red" ? 1 : 0), 0),
    heat: Math.max(0, ...rest.map((c) => c.heat)),
  });
  return kept;
}

/**
 * Builds the whole universe. Pure and synchronous: the caller feeds it live
 * Firestore listener data, so any change anywhere re-derives the graph —
 * that is the entire "updates automatically" story, no refresh logic needed.
 */
export function buildOsTree(input: OsGraphInput): { root: OsNode; crossEdges: CrossEdge[] } {
  const { now } = input;
  const openTasks = input.tasks.filter((t) => t.status !== "done");
  const pendingReminders = input.reminders.filter((r) => r.status === "pending");
  const activeProjects = input.projects.filter((p) => p.status !== "archived");
  const projectIds = new Set(activeProjects.map((p) => p.id));
  const predictions = input.predictions ?? [];

  const projectNodes: OsNode[] = activeProjects.map((project) => {
    const tasks = openTasks
      .filter((t) => t.projectId === project.id)
      .map((t) => taskNode(t, now));
    // Ghosts ride outside the cluster fold: a prediction the AI bothered to
    // make should never be hidden inside "+N more".
    const ghosts: OsNode[] = predictions
      .filter((p) => p.projectId === project.id)
      .map((p, i) => ({
        id: `ghost-${project.id}-${i}`,
        kind: "ghost",
        label: p.label,
        sublabel: "AI suggestion",
        status: "gray",
        href: p.href,
        children: [],
        alerts: 0,
        heat: 0,
        detail: p.reason,
      }));
    const children = [...clusterChildren(tasks, `project-${project.id}`), ...ghosts];
    return {
      id: `project-${project.id}`,
      kind: "project",
      label: truncate(project.name),
      sublabel: `${project.status} · ${project.progress ?? 0}%`,
      status: projectStatus(project),
      href: `/projects/${project.id}`,
      children,
      alerts: children.reduce((sum, c) => sum + c.alerts + (c.status === "red" ? 1 : 0), 0),
      heat: Math.max(heatOf(project.updatedAt, now), ...tasks.map((t) => t.heat)),
    };
  });

  const personNodes: OsNode[] = input.people.map((person) => ({
    id: `person-${person.id}`,
    kind: "person",
    label: truncate(person.name),
    sublabel: person.company || "contact",
    status: "neutral",
    href: "/people",
    children: [],
    alerts: 0,
    heat: heatOf(person.createdAt, now),
  }));

  const standaloneTaskNodes = openTasks
    .filter((t) => !t.projectId || !projectIds.has(t.projectId))
    .map((t) => taskNode(t, now));

  const reminderNodes: OsNode[] = pendingReminders.map((reminder) => ({
    id: `reminder-${reminder.id}`,
    kind: "reminder",
    label: truncate(reminder.text),
    sublabel: isOverdue(reminder.dueAt, now) ? "overdue" : "pending",
    status: isOverdue(reminder.dueAt, now) ? "red" : "orange",
    href: "/reminders",
    children: [],
    alerts: 0,
    heat: heatOf(reminder.createdAt, now),
  }));

  const hub = (id: string, label: string, href: string, children: OsNode[]): OsNode => {
    const clustered = clusterChildren(children, id);
    return {
      id,
      kind: "hub",
      label,
      sublabel: `${children.length}`,
      status: "neutral",
      href,
      children: clustered,
      alerts: clustered.reduce((sum, c) => sum + c.alerts + (c.status === "red" ? 1 : 0), 0),
      heat: Math.max(0, ...children.map((c) => c.heat)),
    };
  };

  const hubs: OsNode[] = [];
  if (projectNodes.length) hubs.push(hub("hub-projects", "Projects", "/projects", projectNodes));
  if (personNodes.length) hubs.push(hub("hub-people", "People", "/people", personNodes));
  if (standaloneTaskNodes.length) hubs.push(hub("hub-tasks", "Tasks", "/tasks", standaloneTaskNodes));
  if (reminderNodes.length) hubs.push(hub("hub-reminders", "Reminders", "/reminders", reminderNodes));
  if (input.unprocessedInboxCount > 0) {
    hubs.push({
      id: "hub-inbox",
      kind: "hub",
      label: "Inbox",
      sublabel: `${input.unprocessedInboxCount}`,
      status: "orange",
      href: "/inbox",
      children: [],
      alerts: 0,
      heat: 1,
    });
  }

  const root: OsNode = {
    id: "owner",
    kind: "owner",
    label: input.ownerName,
    sublabel: "Owner · Command Center",
    status: "blue",
    href: null,
    children: hubs,
    alerts: hubs.reduce((sum, h) => sum + h.alerts, 0),
    heat: Math.max(0, ...hubs.map((h) => h.heat)),
  };

  // Cross-relationships: explicit links first, then whole-word name inference
  // so pre-links data still connects. The deterministic edge key dedupes both;
  // an explicit link wins so its recency survives the merge.
  const edges = new Map<string, CrossEdge>();
  const addEdge = (a: string, b: string, recent: boolean) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const existing = edges.get(key);
    if (existing) {
      existing.recent = existing.recent || recent;
      return;
    }
    edges.set(key, { a, b, recent });
  };

  for (const link of input.links) {
    const recent =
      !!link.createdAt && now.getTime() - link.createdAt.toMillis() < RECENT_LINK_MS;
    addEdge(`${link.sourceType}-${link.sourceId}`, `${link.targetType}-${link.targetId}`, recent);
  }
  for (const person of input.people) {
    for (const task of openTasks) {
      if (textMentionsPerson(`${task.title} ${task.description}`, person.name)) {
        addEdge(`person-${person.id}`, `task-${task.id}`, false);
      }
    }
    for (const project of activeProjects) {
      if (textMentionsPerson(project.description, person.name)) {
        addEdge(`person-${person.id}`, `project-${project.id}`, false);
      }
    }
    for (const reminder of pendingReminders) {
      if (textMentionsPerson(reminder.text, person.name)) {
        addEdge(`person-${person.id}`, `reminder-${reminder.id}`, false);
      }
    }
  }

  return { root, crossEdges: [...edges.values()] };
}

/**
 * Ring spacing per depth.
 *
 * Kept tight on purpose. The camera frames the whole tree, so every extra
 * pixel of radius here is paid for by zooming further out — and at ~28 records
 * the old spacing forced a fit around 0.3x, where 9px captions became
 * unreadable smudges. Compact rings buy back the zoom.
 */
const RING = [0, 150, 285, 400, 500];

function visibleLeafCount(node: OsNode, expanded: ReadonlySet<string>): number {
  if (!node.children.length || !expanded.has(node.id)) return 1;
  return node.children.reduce((sum, c) => sum + visibleLeafCount(c, expanded), 0);
}

/**
 * Radial layout by angular allocation: every visible subtree receives a slice
 * of its parent's arc proportional to how many visible leaves it carries, and
 * sits at the centre of its slice. Guarantees no two tree edges cross and no
 * two siblings overlap, whatever gets expanded.
 */
export function layoutRadial(root: OsNode, expanded: ReadonlySet<string>): PlacedNode[] {
  const placed: PlacedNode[] = [
    { node: root, parentId: null, depth: 0, x: 0, y: 0, expanded: true, labelTier: 0 },
  ];

  const place = (
    node: OsNode,
    parentId: string,
    depth: number,
    startAngle: number,
    endAngle: number,
    siblingIndex: number
  ) => {
    const angle = (startAngle + endAngle) / 2;
    const radius = RING[Math.min(depth, RING.length - 1)];
    const isExpanded = expanded.has(node.id) && node.children.length > 0;
    placed.push({
      node,
      parentId,
      depth,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      expanded: isExpanded,
      labelTier: siblingIndex % 2,
    });
    if (!isExpanded) return;

    const total = node.children.reduce((sum, c) => sum + visibleLeafCount(c, expanded), 0);
    let cursor = startAngle;
    node.children.forEach((child, i) => {
      const span = ((endAngle - startAngle) * visibleLeafCount(child, expanded)) / total;
      place(child, node.id, depth + 1, cursor, cursor + span, i);
      cursor += span;
    });
  };

  const total = root.children.reduce((sum, c) => sum + visibleLeafCount(c, expanded), 0);
  // Starting at -90° puts the first hub at the top, which reads as "primary".
  let cursor = -Math.PI / 2;
  root.children.forEach((child, i) => {
    const span = (Math.PI * 2 * visibleLeafCount(child, expanded)) / (total || 1);
    place(child, root.id, 1, cursor, cursor + span, i);
    cursor += span;
  });

  return placed;
}
