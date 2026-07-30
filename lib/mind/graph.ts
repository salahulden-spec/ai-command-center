import type {
  Decision,
  Person,
  Project,
  ProjectDocument,
  Reminder,
  ResearchEntry,
  Task,
} from "@/types";

export type MindNodeType =
  | "project"
  | "task"
  | "person"
  | "reminder"
  | "document"
  | "research"
  | "decision"
  | "unfiled";

export interface MindNode {
  id: string;
  type: MindNodeType;
  label: string;
  meta: string;
  href: string;
  /** Number of edges touching this node — drives node size and the "connected to" panel. */
  degree: number;
  // Mutated in place by d3-force.
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

/** `kind` explains *why* two nodes are linked, so the UI can describe the relationship. */
export type MindLinkKind = "belongsTo" | "mentions";

export interface MindLink {
  source: string;
  target: string;
  kind: MindLinkKind;
}

export interface MindGraph {
  nodes: MindNode[];
  links: MindLink[];
}

/** Anything project-scoped that lives in a subcollection, carrying its parent's id. */
export interface ProjectScoped<T> {
  id: string;
  projectId: string;
  data: T;
}

export interface MindGraphInput {
  projects: Project[];
  tasks: Task[];
  people: Person[];
  reminders: Reminder[];
  documents: ProjectScoped<ProjectDocument>[];
  research: ProjectScoped<ResearchEntry>[];
  decisions: ProjectScoped<Decision>[];
}

const UNFILED_ID = "unfiled";

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Whether a name extracted from a document refers to a saved contact.
 * Exact match after normalising, or one fully containing the other — but only
 * when the shorter side is long enough that a substring hit isn't a coincidence
 * (guards against e.g. a person named "Al" matching every "Alex" mention).
 */
export function isPersonMention(mention: string, personName: string): boolean {
  const a = normalize(mention);
  const b = normalize(personName);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.includes(shorter);
}

function truncate(value: string, max = 60): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Turns the user's records into a connected graph.
 *
 * Every edge mirrors a relationship that genuinely exists in Firestore —
 * subcollection parentage, an explicit `projectId`, or a person named inside a
 * document's extracted entities. Nothing is inferred or invented, so what the
 * graph shows is always something the user could verify on the source page.
 *
 * Records with no home (standalone tasks, reminders with no project) attach to
 * a single synthetic "Unfiled" hub rather than floating loose, which keeps the
 * layout readable instead of scattering orphans around the edges.
 */
export function buildMindGraph(input: MindGraphInput): MindGraph {
  const nodes: MindNode[] = [];
  const links: MindLink[] = [];
  const projectIds = new Set(input.projects.map((p) => p.id));

  const projectNodeId = (id: string) => `project-${id}`;
  let usesUnfiled = false;

  /** Resolves the hub a record hangs off, falling back to Unfiled when its project is gone. */
  const anchorFor = (projectId: string | null | undefined): string => {
    if (projectId && projectIds.has(projectId)) return projectNodeId(projectId);
    usesUnfiled = true;
    return UNFILED_ID;
  };

  for (const project of input.projects) {
    nodes.push({
      id: projectNodeId(project.id),
      type: "project",
      label: project.name,
      meta: `${project.status} · ${project.progress ?? 0}%`,
      href: `/projects/${project.id}`,
      degree: 0,
    });
  }

  for (const task of input.tasks) {
    const id = `task-${task.id}`;
    nodes.push({
      id,
      type: "task",
      label: truncate(task.title),
      meta: task.status,
      href: task.projectId ? `/projects/${task.projectId}` : "/tasks",
      degree: 0,
    });
    links.push({ source: id, target: anchorFor(task.projectId), kind: "belongsTo" });
  }

  for (const reminder of input.reminders) {
    const id = `reminder-${reminder.id}`;
    nodes.push({
      id,
      type: "reminder",
      label: truncate(reminder.text),
      meta: reminder.status,
      href: "/reminders",
      degree: 0,
    });
    links.push({ source: id, target: anchorFor(reminder.relatedProjectId), kind: "belongsTo" });
  }

  for (const entry of input.research) {
    const id = `research-${entry.id}`;
    nodes.push({
      id,
      type: "research",
      label: truncate(entry.data.title),
      meta: "research",
      href: `/projects/${entry.projectId}`,
      degree: 0,
    });
    links.push({ source: id, target: anchorFor(entry.projectId), kind: "belongsTo" });
  }

  for (const entry of input.decisions) {
    const id = `decision-${entry.id}`;
    nodes.push({
      id,
      type: "decision",
      label: truncate(entry.data.question),
      meta: `→ ${entry.data.recommended}`,
      href: `/projects/${entry.projectId}`,
      degree: 0,
    });
    links.push({ source: id, target: anchorFor(entry.projectId), kind: "belongsTo" });
  }

  for (const person of input.people) {
    nodes.push({
      id: `person-${person.id}`,
      type: "person",
      label: person.name,
      meta: person.company || "contact",
      href: "/people",
      degree: 0,
    });
  }

  for (const entry of input.documents) {
    const id = `document-${entry.id}`;
    nodes.push({
      id,
      type: "document",
      label: truncate(entry.data.fileName),
      meta: entry.data.status,
      href: `/projects/${entry.projectId}`,
      degree: 0,
    });
    links.push({ source: id, target: anchorFor(entry.projectId), kind: "belongsTo" });

    // A document naming someone you've saved as a contact is a real cross-link:
    // it's how People stop being isolated dots and join the rest of the graph.
    const mentioned = entry.data.extractedEntities?.people ?? [];
    for (const person of input.people) {
      if (mentioned.some((name) => isPersonMention(name, person.name))) {
        links.push({ source: id, target: `person-${person.id}`, kind: "mentions" });
      }
    }
  }

  if (usesUnfiled) {
    nodes.unshift({
      id: UNFILED_ID,
      type: "unfiled",
      label: "Unfiled",
      meta: "not tied to a project",
      href: "/tasks",
      degree: 0,
    });
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const link of links) {
    const source = byId.get(link.source);
    const target = byId.get(link.target);
    if (source) source.degree += 1;
    if (target) target.degree += 1;
  }

  return { nodes, links };
}
