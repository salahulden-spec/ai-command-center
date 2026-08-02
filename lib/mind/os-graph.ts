import type { EntityLink, Person, Project, Reminder, Task } from "@/types";

/**
 * The Mind View's model: a radial tree with the owner at the centre and
 * progressive disclosure outward — categories, then records, then a project's
 * own tasks. A tree (rather than a force layout) is a deliberate choice: it
 * cannot produce crossing edges, it is deterministic so nothing jiggles on
 * refresh, and collapsed depth is what keeps a workspace of hundreds of
 * records readable. Cross-relationships (a person involved in a task) are not
 * tree edges; they are drawn as separate arcs between visible nodes.
 */

export type OsNodeKind = "owner" | "hub" | "project" | "person" | "task" | "reminder";

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
}

export interface PlacedNode {
  node: OsNode;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
  /** Whether this node currently shows its children. */
  expanded: boolean;
}

export interface CrossEdge {
  a: string;
  b: string;
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
}

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
});

/**
 * Builds the whole tree. Pure and synchronous: the caller feeds it live
 * Firestore listener data, so any change anywhere re-derives the graph —
 * that is the entire "updates automatically" story, no refresh logic needed.
 */
export function buildOsTree(input: OsGraphInput): { root: OsNode; crossEdges: CrossEdge[] } {
  const { now } = input;
  const openTasks = input.tasks.filter((t) => t.status !== "done");
  const pendingReminders = input.reminders.filter((r) => r.status === "pending");
  const activeProjects = input.projects.filter((p) => p.status !== "archived");
  const projectIds = new Set(activeProjects.map((p) => p.id));

  const projectNodes: OsNode[] = activeProjects.map((project) => {
    const children = openTasks
      .filter((t) => t.projectId === project.id)
      .map((t) => taskNode(t, now));
    return {
      id: `project-${project.id}`,
      kind: "project",
      label: truncate(project.name),
      sublabel: `${project.status} · ${project.progress ?? 0}%`,
      status: projectStatus(project),
      href: `/projects/${project.id}`,
      children,
      alerts: children.filter((c) => c.status === "red").length,
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
  }));

  const hub = (id: string, label: string, href: string, children: OsNode[]): OsNode => ({
    id,
    kind: "hub",
    label,
    sublabel: `${children.length}`,
    status: "neutral",
    href,
    children,
    alerts: children.reduce((sum, c) => sum + c.alerts + (c.status === "red" ? 1 : 0), 0),
  });

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
  };

  // Cross-relationships: explicit links first, then whole-word name inference
  // so pre-links data still connects. The deterministic edge key dedupes both.
  const edgeKeys = new Set<string>();
  const crossEdges: CrossEdge[] = [];
  const addEdge = (a: string, b: string) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    crossEdges.push({ a, b });
  };

  for (const link of input.links) {
    addEdge(`${link.sourceType}-${link.sourceId}`, `${link.targetType}-${link.targetId}`);
  }
  for (const person of input.people) {
    for (const task of openTasks) {
      if (textMentionsPerson(`${task.title} ${task.description}`, person.name)) {
        addEdge(`person-${person.id}`, `task-${task.id}`);
      }
    }
    for (const project of activeProjects) {
      if (textMentionsPerson(project.description, person.name)) {
        addEdge(`person-${person.id}`, `project-${project.id}`);
      }
    }
    for (const reminder of pendingReminders) {
      if (textMentionsPerson(reminder.text, person.name)) {
        addEdge(`person-${person.id}`, `reminder-${reminder.id}`);
      }
    }
  }

  return { root, crossEdges };
}

/** Ring spacing per depth. Wider first ring gives the owner node breathing room. */
const RING = [0, 190, 360, 500];

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
export function layoutRadial(
  root: OsNode,
  expanded: ReadonlySet<string>
): PlacedNode[] {
  const placed: PlacedNode[] = [
    { node: root, parentId: null, depth: 0, x: 0, y: 0, expanded: true },
  ];

  const place = (
    node: OsNode,
    parentId: string,
    depth: number,
    startAngle: number,
    endAngle: number
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
    });
    if (!isExpanded) return;

    const total = node.children.reduce((sum, c) => sum + visibleLeafCount(c, expanded), 0);
    let cursor = startAngle;
    for (const child of node.children) {
      const span = ((endAngle - startAngle) * visibleLeafCount(child, expanded)) / total;
      place(child, node.id, depth + 1, cursor, cursor + span);
      cursor += span;
    }
  };

  const total = root.children.reduce((sum, c) => sum + visibleLeafCount(c, expanded), 0);
  // Starting at -90° puts the first hub at the top, which reads as "primary".
  let cursor = -Math.PI / 2;
  for (const child of root.children) {
    const span = (Math.PI * 2 * visibleLeafCount(child, expanded)) / (total || 1);
    place(child, root.id, 1, cursor, cursor + span);
    cursor += span;
  }

  return placed;
}
