import test from "node:test";
import assert from "node:assert/strict";
import { buildUniverse, OWNER_ID, relationsOf, type Entity, type UniverseInput } from "./universe.ts";
import {
  CARD_EXTENT,
  gravityOf,
  integrate,
  layoutNeighbourhood,
  separate,
  type Body,
  type SpringBody,
} from "./spatial.ts";

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

/** Contacts only appear once something is attached, so fixtures must attach. */
const worksOn = (personId: string, projectId: string) =>
  ({
    id: `l-${personId}`,
    sourceType: "person",
    sourceId: personId,
    targetType: "project",
    targetId: projectId,
    createdAt: ts(),
  }) as never;

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
  memories: [],
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

test("the urgent record leads its zone", () => {
  const u = buildUniverse({
    ...base,
    tasks: [task("t1", "Overdue", null, { dueDate: ts(-DAY) }), task("t2", "Calm", null)],
  });

  const { placed } = lay(u, u.byId.get(OWNER_ID)!, OPTS);
  const at = (id: string) => placed.find((p) => p.entity.id === id)!;

  assert.ok(at("task:t1").x > 0 && at("task:t2").x > 0, "both are in the Tasks zone, to the right");
  assert.ok(at("task:t1").y < at("task:t2").y, "and the overdue one is at the top of the column");
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

test("each type owns its own region of the field", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: [task("t1", "One", null)],
    people: [person("pe1", "Ahmed")],
    reminders: [reminder("r1", "Chase it")],
    links: [worksOn("pe1", "p1")],
  });

  const { placed, zones } = lay(u, u.byId.get(OWNER_ID)!, OPTS);
  const at = (id: string) => placed.find((p) => p.entity.id === id)!;

  assert.ok(at("project:p1").y < 0, "projects sit above the core");
  assert.ok(at("task:t1").x > 0, "tasks to the right");
  assert.ok(at("person:pe1").x < 0, "people to the left");
  assert.ok(at("reminder:r1").y > 0, "reminders below");

  assert.ok(
    Math.hypot(at("project:p1").x, at("project:p1").y) <
      Math.hypot(at("task:t1").x, at("task:t1").y),
    "and projects sit nearer the core than individual tasks"
  );

  // Every zone announces itself above the cards it holds.
  for (const zone of zones) {
    const mine = placed.filter((p) => p.entity.kind === zone.kind);
    assert.ok(mine.length > 0, `${zone.kind} zone has cards`);
    assert.ok(
      zone.y < Math.min(...mine.map((p) => p.y)),
      `the ${zone.kind} caption sits above its cards`
    );
  }
});

test("a project's own records join their type's zone and still hang off the project", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: [task("t1", "One", "p1"), task("t2", "Two", "p1")],
  });

  const { placed } = lay(u, u.byId.get(OWNER_ID)!, OPTS);
  const second = placed.filter((p) => p.depth === 2);
  assert.equal(second.length, 2, "both project tasks are on screen");
  assert.ok(
    second.every((p) => p.parentId === "project:p1"),
    "and they hang off the project, not off you"
  );
  assert.ok(second.every((p) => p.x > 0), "but they are laid out in the Tasks zone like any task");
});

test("a hub record cannot flood the frame", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: Array.from({ length: 30 }, (_, i) => task(`t${i}`, `Task ${i}`, "p1")),
  });

  const { placed, zones } = lay(u, u.byId.get(OWNER_ID)!, OPTS);
  const shown = placed.filter((p) => p.entity.kind === "task");
  assert.ok(shown.length <= 8, `the Tasks zone is capped, got ${shown.length}`);

  const tasks = zones.find((z) => z.kind === "task")!;
  assert.equal(tasks.shown, shown.length);
  assert.equal(tasks.count, 30, "and the caption still knows the real total");
});

test("a crowded zone is budgeted, and its caption says what it stands for", () => {
  const u = buildUniverse({
    ...base,
    projects: Array.from({ length: 4 }, (_, i) => project(`p${i}`, `Project ${i}`)),
    people: Array.from({ length: 18 }, (_, i) => person(`pe${i}`, `Person ${i}`)),
    tasks: [task("t1", "Loose", null)],
    links: Array.from({ length: 18 }, (_, i) => worksOn(`pe${i}`, "p0")),
  });

  const { placed, zones } = lay(u, u.byId.get(OWNER_ID)!, OPTS);

  const people = zones.find((z) => z.kind === "person")!;
  assert.ok(people.shown < people.count, "the crowded type is truncated");
  assert.equal(people.count, 18, "but the caption still knows the real total");
  assert.equal(
    placed.filter((p) => p.entity.kind === "person").length,
    people.shown,
    "and the caption agrees with what is drawn"
  );

  const tasks = zones.find((z) => z.kind === "task")!;
  assert.equal(tasks.shown, 1, "a type with one record still shows it");
});

test("a full zone wraps into another column rather than crowding one", () => {
  const build = (n: number) =>
    buildUniverse({
      ...base,
      projects: [project("p0", "Alpha")],
      people: Array.from({ length: n }, (_, i) => person(`pe${i}`, `Person ${i}`)),
      links: Array.from({ length: n }, (_, i) => worksOn(`pe${i}`, "p0")),
    });

  const few = lay(build(3), build(3).byId.get(OWNER_ID)!, OPTS);
  const many = build(14);
  const lots = lay(many, many.byId.get(OWNER_ID)!, OPTS);

  assert.ok(lots.extentX > few.extentX, "the picture widens to hold the extra column");

  const columns = new Set(
    lots.placed
      .filter((p) => p.entity.kind === "person")
      .map((p) => Math.round(p.x / 10))
  );
  assert.ok(columns.size >= 2, "eight cards do not share a single column");

  // And no two cards land in the same place.
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
    links: [worksOn("pe1", "p1")],
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

test("you are never a card on someone else's map", () => {
  const u = buildUniverse({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: [task("t1", "One", "p1")],
  });

  const { placed } = lay(u, u.byId.get("project:p1")!, OPTS);
  assert.equal(placed[0].entity.id, "project:p1", "the project holds the centre");
  assert.ok(
    !placed.some((p) => p.entity.kind === "owner"),
    "and there is no card for you anywhere on it"
  );
});

test("an isolated focal record still frames cleanly instead of dividing by zero", () => {
  const u = buildUniverse({ ...base, people: [person("pe1", "Ahmed")] });
  const { placed, extentX, extentY, zones } = lay(u, u.byId.get("person:pe1")!, {
    showDone: true,
    hidden: new Set(["owner"]),
  });
  assert.equal(placed.length, 1, "only itself");
  assert.equal(zones.length, 0);
  assert.ok(Number.isFinite(extentX) && extentX > 0);
  assert.ok(Number.isFinite(extentY) && extentY > 0);
});

/**
 * The failure this guards against — cards laid on top of each other — is
 * invisible to every other test, and it is now layout's job rather than the
 * render loop's: the loop is allowed to stop, so whatever it is handed has to
 * already be a legal arrangement.
 */
test("the composition it hands over has no card sitting on another", () => {
  // A workspace shaped like a real one: a few projects, a pile of tasks and
  // contacts, some reminders — more than the zones can show at once.
  const u = buildUniverse({
    ...base,
    projects: Array.from({ length: 3 }, (_, i) => project(`p${i}`, `Project number ${i}`)),
    tasks: [
      ...Array.from({ length: 8 }, (_, i) => task(`t${i}`, `A task with a longish title ${i}`, null)),
      ...Array.from({ length: 4 }, (_, i) => task(`pt${i}`, `Project task ${i}`, "p0")),
    ],
    people: Array.from({ length: 10 }, (_, i) => person(`pe${i}`, `Person Number${i}`)),
    reminders: Array.from({ length: 5 }, (_, i) => reminder(`r${i}`, `Remember this thing ${i}`)),
    links: Array.from({ length: 10 }, (_, i) => worksOn(`pe${i}`, "p0")),
  });

  const { placed } = lay(u, u.byId.get(OWNER_ID)!, OPTS);

  let overlaps = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const [arx, ary] = CARD_EXTENT[a.entity.kind];
      const [brx, bry] = CARD_EXTENT[b.entity.kind];
      if (Math.abs(b.x - a.x) < arx + brx && Math.abs(b.y - a.y) < ary + bry) overlaps++;
    }
  }
  assert.equal(overlaps, 0, `${overlaps} cards overlap in the laid-out composition`);

  const focal = placed[0];
  assert.equal(focal.x, 0, "and the centre never drifted");
  assert.equal(focal.y, 0);
});

/**
 * The bug these three guard against is the one you could see: the map never
 * stopped moving, and at any real zoom the shiver was obvious. Nothing else in
 * the suite would notice a simulation that runs forever, because "runs
 * forever" still produces a picture that looks right in a screenshot.
 */
const flying = (u: ReturnType<typeof buildUniverse>): SpringBody[] =>
  lay(u, u.byId.get(OWNER_ID)!, OPTS).placed.map((p) => {
    const [rx, ry] = CARD_EXTENT[p.entity.kind];
    // Everything starts stacked on the origin, exactly as it does on the first
    // frame after a Firestore snapshot arrives.
    return { x: 0, y: 0, vx: 0, vy: 0, tx: p.x, ty: p.y, rx, ry, fixed: p.depth === 0, asleep: false };
  });

const busy = () =>
  buildUniverse({
    ...base,
    projects: Array.from({ length: 3 }, (_, i) => project(`p${i}`, `Project number ${i}`)),
    tasks: [
      ...Array.from({ length: 8 }, (_, i) => task(`t${i}`, `A task ${i}`, null)),
      ...Array.from({ length: 4 }, (_, i) => task(`pt${i}`, `Project task ${i}`, "p0")),
    ],
    people: Array.from({ length: 10 }, (_, i) => person(`pe${i}`, `Person Number${i}`)),
    reminders: Array.from({ length: 5 }, (_, i) => reminder(`r${i}`, `Remember ${i}`)),
    links: Array.from({ length: 10 }, (_, i) => worksOn(`pe${i}`, "p0")),
  });

test("the simulation comes to a complete stop", () => {
  const bodies = flying(busy());

  let frames = 0;
  while (integrate(bodies, 1)) {
    if (++frames > 600) break;
  }

  assert.ok(frames < 600, `still moving after ${frames} frames`);
  assert.ok(
    bodies.every((b) => b.asleep || b.fixed),
    "every card has gone to sleep"
  );
  // Not "close to" — on. An asymptotic approach is what the shimmer was.
  for (const b of bodies) {
    if (b.fixed) continue;
    assert.equal(b.x, b.tx, "a settled card is exactly on its target");
    assert.equal(b.y, b.ty);
  }
});

test("a settled map does not move again on its own", () => {
  const bodies = flying(busy());
  for (let i = 0; i < 600 && integrate(bodies, 1); i++);

  const before = bodies.map((b) => `${b.x},${b.y}`);
  for (let i = 0; i < 240; i++) {
    assert.equal(integrate(bodies, 1), false, `frame ${i} reported movement at rest`);
  }
  assert.deepEqual(bodies.map((b) => `${b.x},${b.y}`), before, "and nothing drifted");
});

test("it settles in the same place however fast the display refreshes", () => {
  const at60 = flying(busy());
  for (let i = 0; i < 900 && integrate(at60, 1); i++);

  // 120Hz: twice as many frames, each half the elapsed time.
  const at120 = flying(busy());
  for (let i = 0; i < 1800 && integrate(at120, 0.5); i++);

  assert.deepEqual(
    at120.map((b) => `${Math.round(b.x)},${Math.round(b.y)}`),
    at60.map((b) => `${Math.round(b.x)},${Math.round(b.y)}`)
  );
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

test("separation stops early once nothing is touching", () => {
  const bodies: Body[] = [
    { x: 0, y: 0, rx: 10, ry: 10, fixed: false },
    { x: 500, y: 500, rx: 10, ry: 10, fixed: false },
  ];
  const before = bodies.map((b) => ({ ...b }));
  separate(bodies, 50);
  assert.deepEqual(bodies, before, "a resolved arrangement is left exactly as it was");
});
