import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUniverse,
  layoutOrbit,
  mentions,
  relationsOf,
  OWNER_ID,
  type UniverseInput,
} from "./universe.ts";

const NOW = new Date("2026-08-03T12:00:00Z");
const DAY = 86_400_000;
const ts = (offset = 0) =>
  ({ toDate: () => new Date(NOW.getTime() + offset), toMillis: () => NOW.getTime() + offset }) as never;

const project = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    name,
    description: "",
    status: "active",
    objectives: [],
    progress: 0,
    createdAt: ts(),
    updatedAt: ts(),
    ...extra,
  }) as never;

const task = (id: string, title: string, projectId: string | null, extra: Record<string, unknown> = {}) =>
  ({
    id,
    title,
    description: "",
    status: "todo",
    priority: "medium",
    dueDate: null,
    projectId,
    source: "manual",
    createdAt: ts(),
    updatedAt: null,
    ...extra,
  }) as never;

const person = (id: string, name: string) =>
  ({ id, name, company: "", notes: "", createdAt: ts() }) as never;

const base: UniverseInput = {
  ownerName: "Salah",
  projects: [],
  tasks: [],
  people: [],
  reminders: [],
  links: [],
  now: NOW,
};

test("every record reaches the owner, directly or through its project", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Vendor Passport")],
    tasks: [task("t1", "Inside a project", "p1"), task("t2", "Standalone", null)],
    people: [person("pe1", "Ahmed")],
  });

  assert.ok(u.edges.get(OWNER_ID)!.has("project:p1"));
  assert.ok(u.edges.get(OWNER_ID)!.has("person:pe1"), "people connect to you");
  assert.ok(u.edges.get(OWNER_ID)!.has("task:t2"), "a standalone task hangs off you");
  assert.ok(u.edges.get("project:p1")!.has("task:t1"), "a project task hangs off its project");
  assert.ok(!u.edges.get(OWNER_ID)!.has("task:t1"), "and not off you as well");
});

test("a task pointing at a project that no longer exists still reaches the owner", () => {
  // This workspace really did accumulate tasks under hallucinated project ids.
  // They must not vanish from the graph the way they used to.
  const u = buildUniverse({ ...base, tasks: [task("t1", "Orphan", "websiteRedesignId")] });
  assert.ok(u.edges.get(OWNER_ID)!.has("task:t1"));
});

test("relationships come from explicit links and from names in the text", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: [task("t1", "Call Mujeeb about pricing", null)],
    people: [person("pe1", "Ahmed"), person("pe2", "Mujeeb")],
    links: [
      { id: "l1", sourceType: "person", sourceId: "pe1", targetType: "project", targetId: "p1", createdAt: ts() } as never,
    ],
  });

  assert.ok(u.edges.get("person:pe1")!.has("project:p1"), "explicit link");
  assert.ok(u.edges.get("person:pe2")!.has("task:t1"), "inferred from the task title");
  assert.ok(u.edges.get("task:t1")!.has("person:pe2"), "and recorded on both endpoints");
});

test("mention matching needs a whole word", () => {
  assert.ok(mentions("Call Ahmed today", "Ahmed"));
  assert.ok(!mentions("Review the quality report", "Ali"));
  assert.ok(!mentions("anything", "Jo"), "names under three characters never match");
});

test("neighbours are grouped by type, urgent first", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: [
      task("t1", "Calm", "p1"),
      task("t2", "Late", "p1", { dueDate: ts(-DAY) }),
      task("t3", "Finished", "p1", { status: "done" }),
    ],
  });

  const groups = relationsOf(u, "project:p1");
  const tasks = groups.find((g) => g.kind === "task")!;
  assert.equal(tasks.items[0].label, "Late", "urgent leads");
  assert.equal(tasks.items[2].label, "Finished", "done sinks");
  assert.ok(tasks.items[0].urgent);
  assert.ok(groups.some((g) => g.kind === "owner"), "the way back up is a neighbour too");
});

test("layout puts every node on a ring and never stacks two in one spot", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: Array.from({ length: 14 }, (_, i) => task(`t${i}`, `Task ${i}`, "p1")),
    people: [person("pe1", "Ahmed")],
    links: [
      { id: "l1", sourceType: "person", sourceId: "pe1", targetType: "project", targetId: "p1", createdAt: ts() } as never,
    ],
  });

  const { placed, sectors, extent } = layoutOrbit(relationsOf(u, "project:p1"));
  assert.equal(placed.length, 16, "14 tasks + 1 assigned person + the owner");
  assert.equal(sectors.length, 3, "one sector each for tasks, people, and the way back up");

  // Overflow moves outward rather than crowding a single arc.
  assert.ok(placed.some((p) => p.ring === 1), "a 14-item sector spills to a second ring");
  assert.ok(extent > 230);

  const seen = new Set<string>();
  for (const p of placed) {
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    assert.ok(!seen.has(key), `two nodes share ${key}`);
    seen.add(key);
  }
});

test("an isolated focal entity lays out cleanly instead of dividing by zero", () => {
  const u = buildUniverse({ ...base, people: [person("pe1", "Ahmed")] });
  const groups = relationsOf(u, "person:pe1");
  const { placed } = layoutOrbit(groups);
  assert.equal(placed.length, 1, "only the owner");
  assert.ok(Number.isFinite(placed[0].x) && Number.isFinite(placed[0].y));
});
