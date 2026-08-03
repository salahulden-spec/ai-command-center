import type { EntityLink, Person, Project, Reminder, Task } from "@/types";

/**
 * The Mind View's model, rebuilt around one idea: you are always standing
 * somewhere, and you see what that place connects to.
 *
 * There is no global tree. The universe is a plain undirected graph of every
 * record, and the view renders the *neighbourhood* of a single focal entity —
 * that entity at the centre, everything related to it arranged around it in
 * labelled sectors by type. Clicking a neighbour makes it the new centre.
 *
 * Two properties fall out of that choice, and both were problems before:
 *
 * 1. Edges can never cross. Every drawn line runs from the centre to a ring
 *    node, so the picture is a star — there is no arrangement of the data that
 *    produces a tangle.
 * 2. The number of nodes on screen is bounded by how connected one record is,
 *    not by how much the workspace contains. A thousand tasks still render as
 *    a readable ring.
 */

export type EntityKind = "owner" | "project" | "task" | "person" | "reminder";

export interface Entity {
  /** `${kind}:${recordId}` — the graph's identity, distinct from the Firestore id. */
  id: string;
  kind: EntityKind;
  recordId: string;
  label: string;
  sublabel: string;
  /** Needs attention now: overdue, or high priority and still open. */
  urgent: boolean;
  /** Finished. Kept in the graph (unlike before) but drawn quietly. */
  done: boolean;
  /** 0..1, how recently this moved. Drives the heat view. */
  heat: number;
}

export interface Universe {
  byId: Map<string, Entity>;
  /** Undirected adjacency. Every relationship appears on both endpoints. */
  edges: Map<string, Set<string>>;
}

export interface UniverseInput {
  ownerName: string;
  projects: Project[];
  tasks: Task[];
  people: Person[];
  reminders: Reminder[];
  links: EntityLink[];
  now: Date;
}

export const OWNER_ID = "owner:me";

const DAY_MS = 86_400_000;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word name match, so a contact called "Ali" never matches "quality". */
export function mentions(text: string, personName: string): boolean {
  const name = normalize(personName);
  if (name.length < 3) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}([^\\p{L}\\p{N}]|$)`, "u").test(
    normalize(text)
  );
}

function truncate(value: string, max = 22): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function heatOf(ts: { toMillis(): number } | null | undefined, now: Date): number {
  if (!ts) return 0;
  return Math.max(0, 1 - (now.getTime() - ts.toMillis()) / (14 * DAY_MS));
}

/**
 * Builds the whole graph. Pure and synchronous — the caller feeds it live
 * listener data, so every Firestore change re-derives the universe and the
 * view follows without any refresh logic.
 */
export function buildUniverse(input: UniverseInput): Universe {
  const { now } = input;
  const byId = new Map<string, Entity>();
  const edges = new Map<string, Set<string>>();

  const add = (entity: Entity) => {
    byId.set(entity.id, entity);
    if (!edges.has(entity.id)) edges.set(entity.id, new Set());
  };
  const connect = (a: string, b: string) => {
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    edges.get(a)!.add(b);
    edges.get(b)!.add(a);
  };

  add({
    id: OWNER_ID,
    kind: "owner",
    recordId: "me",
    label: input.ownerName,
    sublabel: "you",
    urgent: false,
    done: false,
    heat: 1,
  });

  for (const project of input.projects) {
    add({
      id: `project:${project.id}`,
      kind: "project",
      recordId: project.id,
      label: truncate(project.name),
      sublabel: `${project.status} · ${project.progress ?? 0}%`,
      urgent: project.status === "blocked",
      done: project.status === "done" || project.status === "archived",
      heat: heatOf(project.updatedAt, now),
    });
    connect(OWNER_ID, `project:${project.id}`);
  }

  for (const task of input.tasks) {
    const overdue = !!task.dueDate && task.dueDate.toMillis() < now.getTime();
    const done = task.status === "done";
    add({
      id: `task:${task.id}`,
      kind: "task",
      recordId: task.id,
      label: truncate(task.title),
      sublabel: overdue && !done ? `${task.status} · overdue` : task.status,
      urgent: !done && (overdue || task.priority === "high"),
      done,
      heat: heatOf(task.updatedAt ?? task.createdAt, now),
    });
    // A task hangs off its project, or off you when it stands alone.
    const parent = task.projectId ? `project:${task.projectId}` : OWNER_ID;
    connect(byId.has(parent) ? parent : OWNER_ID, `task:${task.id}`);
  }

  for (const person of input.people) {
    add({
      id: `person:${person.id}`,
      kind: "person",
      recordId: person.id,
      label: truncate(person.name),
      sublabel: person.company || "contact",
      urgent: false,
      done: false,
      heat: heatOf(person.createdAt, now),
    });
    connect(OWNER_ID, `person:${person.id}`);
  }

  for (const reminder of input.reminders) {
    const overdue = reminder.dueAt.toMillis() < now.getTime();
    const done = reminder.status === "done";
    add({
      id: `reminder:${reminder.id}`,
      kind: "reminder",
      recordId: reminder.id,
      label: truncate(reminder.text),
      sublabel: done ? "done" : overdue ? "overdue" : "pending",
      urgent: !done && overdue,
      done,
      heat: heatOf(reminder.createdAt, now),
    });
    const parent = reminder.relatedProjectId ? `project:${reminder.relatedProjectId}` : OWNER_ID;
    connect(byId.has(parent) ? parent : OWNER_ID, `reminder:${reminder.id}`);
  }

  // Explicit relationships recorded by the assistant or by hand.
  for (const link of input.links) {
    connect(`${link.sourceType}:${link.sourceId}`, `${link.targetType}:${link.targetId}`);
  }

  // Inferred relationships: a person named in a record's own text. This is what
  // keeps People connected in a workspace that predates explicit links.
  for (const person of input.people) {
    for (const task of input.tasks) {
      if (mentions(`${task.title} ${task.description}`, person.name)) {
        connect(`person:${person.id}`, `task:${task.id}`);
      }
    }
    for (const project of input.projects) {
      if (mentions(`${project.name} ${project.description}`, person.name)) {
        connect(`person:${person.id}`, `project:${project.id}`);
      }
    }
    for (const reminder of input.reminders) {
      if (mentions(reminder.text, person.name)) {
        connect(`person:${person.id}`, `reminder:${reminder.id}`);
      }
    }
  }

  return { byId, edges };
}

/** Order sectors appear in, clockwise from the top. */
const KIND_ORDER: EntityKind[] = ["project", "task", "person", "reminder", "owner"];

export interface RelationGroup {
  kind: EntityKind;
  items: Entity[];
}

/**
 * The focal entity's neighbours, bucketed by type and sorted so the ones that
 * matter lead: urgent first, then unfinished, then most recently touched.
 */
export function relationsOf(universe: Universe, focalId: string): RelationGroup[] {
  const neighbourIds = universe.edges.get(focalId);
  if (!neighbourIds) return [];

  const buckets = new Map<EntityKind, Entity[]>();
  for (const id of neighbourIds) {
    const entity = universe.byId.get(id);
    if (!entity) continue;
    if (!buckets.has(entity.kind)) buckets.set(entity.kind, []);
    buckets.get(entity.kind)!.push(entity);
  }

  const groups: RelationGroup[] = [];
  for (const kind of KIND_ORDER) {
    const items = buckets.get(kind);
    if (!items?.length) continue;
    items.sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      if (a.done !== b.done) return a.done ? 1 : -1;
      return b.heat - a.heat;
    });
    groups.push({ kind, items });
  }
  return groups;
}

export interface PlacedEntity {
  entity: Entity;
  x: number;
  y: number;
  /** Which concentric ring, 0-based. Outer rings hold the overflow. */
  ring: number;
  /** Mid-angle of the sector this belongs to, for drawing the sector label. */
  sectorAngle: number;
  kind: EntityKind;
}

export interface OrbitLayout {
  placed: PlacedEntity[];
  sectors: { kind: EntityKind; angle: number; radius: number; count: number }[];
  /** Distance to the outermost occupied ring, for framing the camera. */
  extent: number;
}

/** Smallest gap between neighbouring nodes on a ring, in world units. */
const MIN_ARC = 108;
/** Nearest a ring ever sits to the centre. */
const BASE_RADIUS = 215;
/** Extra distance for each ring further out. */
const RING_STEP = 135;
/** More than this in one sector and it spreads across additional rings. */
const PER_RING = 7;
/** Angular gap between sectors, so groups read as groups. */
const SECTOR_GAP = 0.16;

/**
 * How far out a ring must sit for `count` nodes to have MIN_ARC between them.
 *
 * A fixed radius was the flaw in the previous layout: 26 neighbours on a
 * 230-unit circle left 55 units per node, and captions are twice that wide, so
 * every label overlapped its neighbours. Deriving the radius from the count
 * makes crowding geometrically impossible — a busier ring is simply a wider
 * one, and the camera zooms out to suit.
 */
function radiusFor(count: number, ring: number): number {
  const needed = (count * MIN_ARC) / (Math.PI * 2);
  return Math.max(BASE_RADIUS + ring * RING_STEP, needed);
}

export function layoutOrbit(groups: RelationGroup[]): OrbitLayout {
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  if (!total) return { placed: [], sectors: [], extent: BASE_RADIUS };

  // Work out which ring each item lands on first, so a ring's radius can be
  // derived from everything that ends up sharing it — not just one sector.
  const assignment = groups.map((group) => {
    const rings = Math.max(1, Math.ceil(group.items.length / PER_RING));
    const perRing = Math.ceil(group.items.length / rings);
    // Spread evenly: ten items across two rings is 5 and 5, never 7 and 3.
    return { group, rings, perRing };
  });

  const countPerRing = new Map<number, number>();
  for (const { group, perRing } of assignment) {
    group.items.forEach((_, i) => {
      const ring = Math.floor(i / perRing);
      countPerRing.set(ring, (countPerRing.get(ring) ?? 0) + 1);
    });
  }
  const radii = new Map<number, number>();
  for (const [ring, count] of countPerRing) radii.set(ring, radiusFor(count, ring));

  const usable = Math.PI * 2 - SECTOR_GAP * groups.length;
  const placed: PlacedEntity[] = [];
  const sectors: OrbitLayout["sectors"] = [];
  let extent = BASE_RADIUS;
  let cursor = -Math.PI / 2; // start at the top, sweep clockwise

  for (const { group, perRing } of assignment) {
    const span = usable * (group.items.length / total);
    const start = cursor + SECTOR_GAP / 2;

    group.items.forEach((entity, i) => {
      const ring = Math.floor(i / perRing);
      const indexInRing = i % perRing;
      const inThisRing = Math.min(perRing, group.items.length - ring * perRing);
      // A short row centres inside its wedge rather than stretching edge to
      // edge, so a two-item sector doesn't read as two unrelated poles.
      const step = inThisRing > 1 ? span / (inThisRing - 1) : 0;
      // Odd rings are nudged half a step round, so an outer node never sits
      // directly behind an inner one — otherwise their captions stack.
      const stagger = ring % 2 === 1 ? step / 2 : 0;
      const angle = inThisRing > 1 ? start + step * indexInRing + stagger : start + span / 2;
      const radius = radii.get(ring) ?? BASE_RADIUS;
      extent = Math.max(extent, radius);
      placed.push({
        entity,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        ring,
        sectorAngle: start + span / 2,
        kind: group.kind,
      });
    });

    sectors.push({
      kind: group.kind,
      angle: start + span / 2,
      radius: radii.get(0) ?? BASE_RADIUS,
      count: group.items.length,
    });
    cursor += span + SECTOR_GAP;
  }

  return { placed, sectors, extent };
}
