import test from "node:test";
import assert from "node:assert/strict";
import { buildUniverse, OWNER_ID, relationsOf, type Entity, type UniverseInput } from "./universe.ts";
import { gravityOf, layoutNeighbourhood, separate, type Body } from "./spatial.ts";

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

const reminder = (id: string, text: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    text,
    dueAt: ts(DAY),
    status: "pending",
    relatedProjectId: null,
    createdAt: ts(),
    ...extra,
  }) as never;

const base: UniverseInput = {
  ownerName: "Owner",
  projects: [],
  tasks: [],
  people: [],
  reminders: [],
  links: [],
  now: NOW,
};

const OPTS = { showDone: true, hidden: new Set<never>() };

/** Feeds the layout the neighbours the page would feed it. */
const lay = (
  u: ReturnType<typeof buildUniverse>,
  focal: Entity,
  opts: Parameters<typeof layoutNeighbourhood>[3]
) => layoutNeighbourhood(u, focal, relationsOf(u, focal.id), opts);

test("gravity ranks urgent above idle above finished", () => {
  const u = buildUniverse({
    ...base,
    tasks: [
      task("t1", "Overdue", null, { dueDate: ts(-DAY) }),
      task("t2", "Open", null),
      task("t3", "Finished", null, { status: "done" }),
    ],
  });

  const g = (id: string) => gravityOf(u.byId.get(id)!);
  assert.ok(g("task:t1") > g("task:t2"), "urgent outweighs merely open");
  assert.ok(g("task:t2") > g("task:t3"), "open outweighs done");
  assert.ok(g("task:t3") >= 0 && g("task:t1") <= 1, "stays inside 0..1");
});

test("gravity pulls the urgent record nearer the centre than the calm one", () => {
  const u = buildUniverse({
    ...base,
    tasks: [task("t1", "Overdue", null, { dueDate: ts(-DAY) }), task("t2", "Calm", null)],
  });

  const { placed } = lay(u, u.byId.get(OWNER_ID)!, OPTS);
  const radius = (id: string) => {
    const p = placed.find((x) => x.entity.id === id)!;
    return Math.hypot(p.x, p.y);
  };
  assert.ok(radius("task:t1") < radius("task:t2"), "the overdue task sits closer in");
});

test("the focal record is pinned at the origin and never a neighbour of itself", () => {
  const u = buildUniverse({ ...base, projects: [project("p1", "Alpha")] });
  const { placed } = lay(u, u.byId.get(OWNER_ID)!, OPTS);

  const focal = placed.filter((p) => p.depth === 0);
  assert.equal(focal.length, 1);
  assert.equal(focal[0].entity.id, OWNER_ID);
  assert.equal(focal[0].x, 0);
  assert.equal(focal[0].y, 0);
  assert.equal(placed.filter((p) => p.entity.id === OWNER_ID).length, 1);
});

test("a second ring fans the neighbours' neighbours around the parent that owns them", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: [task("t1", "One", "p1"), task("t2", "Two", "p1")],
  });

  const { placed } = lay(u, u.byId.get(OWNER_ID)!, OPTS);
  const second = placed.filter((p) => p.depth === 2);
  assert.equal(second.length, 2, "both project tasks appear one ring out");
  assert.ok(
    second.every((p) => p.parentId === "project:p1"),
    "and they hang off the project, not off you"
  );
  const first = placed.find((p) => p.entity.id === "project:p1")!;
  assert.ok(
    second.every((p) => Math.hypot(p.x, p.y) > Math.hypot(first.x, first.y)),
    "the second ring is further out than its parent"
  );
});

test("a hub record cannot flood the frame", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: Array.from({ length: 30 }, (_, i) => task(`t${i}`, `Task ${i}`, "p1")),
  });

  const { placed } = lay(u, u.byId.get(OWNER_ID)!, OPTS);
  const perParent = placed.filter((p) => p.depth === 2 && p.parentId === "project:p1");
  assert.equal(perParent.length, 4, "at most four second-ring items per parent");
});

test("a crowded first ring is budgeted, and the sector says what it stands for", () => {
  const u = buildUniverse({
    ...base,
    projects: Array.from({ length: 4 }, (_, i) => project(`p${i}`, `Project ${i}`)),
    people: Array.from({ length: 18 }, (_, i) => person(`pe${i}`, `Person ${i}`)),
    tasks: [task("t1", "Loose", null)],
  });

  const { placed, sectors } = lay(u, u.byId.get(OWNER_ID)!, OPTS);
  const first = placed.filter((p) => p.depth === 1);
  assert.ok(first.length <= 14, `first ring is capped, got ${first.length}`);

  const people = sectors.find((s) => s.kind === "person")!;
  assert.ok(people.shown < people.count, "the crowded type is truncated");
  assert.equal(people.count, 18, "but the caption still knows the real total");

  const tasksSector = sectors.find((s) => s.kind === "task")!;
  assert.equal(tasksSector.shown, 1, "a type with one record still shows it");
});

test("overflow moves outward rather than crowding one ring", () => {
  const few = buildUniverse({
    ...base,
    people: Array.from({ length: 3 }, (_, i) => person(`pe${i}`, `Person ${i}`)),
  });
  const many = buildUniverse({
    ...base,
    people: Array.from({ length: 14 }, (_, i) => person(`pe${i}`, `Person ${i}`)),
  });

  const one = lay(few, few.byId.get(OWNER_ID)!, OPTS);
  const lots = lay(many, many.byId.get(OWNER_ID)!, OPTS);

  assert.ok(lots.extent > one.extent, "the picture grows to hold the extra cards");

  // Two rings, and nothing sitting between them.
  const radii = [
    ...new Set(
      lots.placed.filter((p) => p.depth === 1).map((p) => Math.round(Math.hypot(p.x, p.y) / 10))
    ),
  ].sort((a, b) => a - b);
  assert.ok(radii.length >= 2, "fourteen cards do not share a single ring");

  // And no two cards on the same ring land in the same place.
  const seen = new Set<string>();
  for (const p of lots.placed) {
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    assert.ok(!seen.has(key), `two cards share ${key}`);
    seen.add(key);
  }
});

test("hidden types and finished work drop out of the picture", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Alpha")],
    people: [person("pe1", "Ahmed")],
    tasks: [task("t1", "Finished", null, { status: "done" })],
  });
  const focal = u.byId.get(OWNER_ID)!;

  const all = lay(u, focal, OPTS).placed.map((p) => p.entity.id);
  assert.ok(all.includes("task:t1"));
  assert.ok(all.includes("person:pe1"));

  const live = lay(u, focal, { showDone: false, hidden: new Set() }).placed.map(
    (p) => p.entity.id
  );
  assert.ok(!live.includes("task:t1"), "done work is out of the default picture");

  const noPeople = lay(u, focal, {
    showDone: true,
    hidden: new Set(["person" as const]),
  }).placed.map((p) => p.entity.id);
  assert.ok(!noPeople.includes("person:pe1"), "a hidden type is gone entirely");
  assert.ok(noPeople.includes("project:p1"), "and nothing else is affected");
});

test("an isolated focal record still frames cleanly instead of dividing by zero", () => {
  const u = buildUniverse({ ...base, people: [person("pe1", "Ahmed")] });
  const { placed, extent, sectors } = lay(u, u.byId.get("person:pe1")!, {
    showDone: true,
    hidden: new Set(["owner"]),
  });
  assert.equal(placed.length, 1, "only itself");
  assert.equal(sectors.length, 0);
  assert.ok(Number.isFinite(extent) && extent > 0);
});

/**
 * Half-extents of each card, in world units, taken from mind.css plus the
 * padding the stage adds. Kept here so the geometry can be checked without a
 * browser — the failure this guards against (cards laid on top of each other on
 * the opening frame) is invisible to every other test.
 */
const SETTLE_PASSES = 8;

const CARD: Record<string, [number, number]> = {
  owner: [83, 83],
  project: [121, 52],
  task: [103, 50],
  person: [104, 34],
  reminder: [100, 50],
};

test("the opening picture settles with no card sitting on another", () => {
  // A workspace shaped like a real one: a few projects, a pile of tasks and
  // contacts, some reminders — more than the ring can show at once.
  const u = buildUniverse({
    ...base,
    projects: Array.from({ length: 3 }, (_, i) => project(`p${i}`, `Project number ${i}`)),
    tasks: [
      ...Array.from({ length: 8 }, (_, i) => task(`t${i}`, `A task with a longish title ${i}`, null)),
      ...Array.from({ length: 4 }, (_, i) => task(`pt${i}`, `Project task ${i}`, "p0")),
    ],
    people: Array.from({ length: 10 }, (_, i) => person(`pe${i}`, `Person Number${i}`)),
    reminders: Array.from({ length: 5 }, (_, i) => reminder(`r${i}`, `Remember this thing ${i}`)),
  });

  const { placed } = lay(u, u.byId.get(OWNER_ID)!, OPTS);
  const bodies: Body[] = placed.map((p) => {
    const [rx, ry] = CARD[p.entity.kind];
    return { x: p.x, y: p.y, rx, ry, fixed: p.depth === 0 };
  });

  // Exactly what the stage does on its first paint.
  separate(bodies, SETTLE_PASSES);

  let overlaps = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (Math.abs(b.x - a.x) < a.rx + b.rx && Math.abs(b.y - a.y) < a.ry + b.ry) overlaps++;
    }
  }
  assert.equal(overlaps, 0, `${overlaps} cards overlap after the opening settle`);

  const focal = bodies[0];
  assert.equal(focal.x, 0, "and the centre never drifted");
  assert.equal(focal.y, 0);
});

test("separation pushes overlapping cards apart on their shallowest axis", () => {
  const bodies: Body[] = [
    { x: 0, y: 0, rx: 100, ry: 40, fixed: false },
    { x: 20, y: 10, rx: 100, ry: 40, fixed: false },
  ];
  separate(bodies);

  const dx = Math.abs(bodies[1].x - bodies[0].x);
  const dy = Math.abs(bodies[1].y - bodies[0].y);
  assert.ok(dx < 200 && dy >= 80, "the shallow axis here is vertical, so they separate vertically");
  assert.ok(
    !(dx < 200 && dy < 80),
    "and the boxes no longer overlap"
  );
});

test("a fixed body never moves, and the mobile one absorbs the whole correction", () => {
  const bodies: Body[] = [
    { x: 0, y: 0, rx: 60, ry: 60, fixed: true },
    { x: 10, y: 0, rx: 60, ry: 60, fixed: false },
  ];
  separate(bodies, 1);

  assert.equal(bodies[0].x, 0, "the focal record holds the centre");
  assert.equal(bodies[0].y, 0);
  assert.ok(bodies[1].x >= 120, "the other one is pushed clear on its own");
});

test("coincident cards are still separated rather than left stacked", () => {
  const bodies: Body[] = [
    { x: 0, y: 0, rx: 50, ry: 50, fixed: false },
    { x: 0, y: 0, rx: 50, ry: 50, fixed: false },
  ];
  separate(bodies);
  assert.ok(Math.hypot(bodies[1].x - bodies[0].x, bodies[1].y - bodies[0].y) > 0);
});
