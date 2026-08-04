import test from "node:test";
import assert from "node:assert/strict";
import { buildUniverse, OWNER_ID, type UniverseInput } from "./universe.ts";
import { adviceFor, type AdviceInput } from "./advice.ts";

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

const build = (over: Partial<UniverseInput> = {}) => {
  const input: UniverseInput = {
    ownerName: "Owner",
    projects: [],
    tasks: [],
    people: [],
    reminders: [],
    memories: [],
    links: [],
    now: NOW,
    ...over,
  };
  const universe = buildUniverse(input);
  const advice: AdviceInput = {
    projects: input.projects,
    tasks: input.tasks,
    people: input.people,
    reminders: input.reminders,
    memories: input.memories,
    now: NOW,
  };
  return { universe, advice };
};

test("a project whose progress bar disagrees with its own task list says so", () => {
  const { universe, advice } = build({
    projects: [project("p1", "Alpha", { progress: 10 })],
    tasks: [
      task("t1", "One", "p1", { status: "done" }),
      task("t2", "Two", "p1", { status: "done" }),
      task("t3", "Three", "p1"),
    ],
  });

  const out = adviceFor(universe, universe.byId.get("project:p1")!, advice);
  const gap = out.find((a) => a.id === "project-progress-gap");
  assert.ok(gap, "the mismatch is reported");
  assert.match(gap!.text, /2 of 3/);
  assert.match(gap!.text, /67%/, "and it states what the tasks actually imply");
});

test("a blocked task outranks everything else on its project and links to itself", () => {
  const { universe, advice } = build({
    projects: [project("p1", "Alpha", { progress: 50 })],
    tasks: [task("t1", "Waiting on a decision", "p1", { status: "blocked" })],
  });

  const out = adviceFor(universe, universe.byId.get("project:p1")!, advice);
  assert.equal(out[0].id, "project-blocked", "it leads");
  assert.equal(out[0].go, "task:t1", "and it points at the blocker");
});

test("an overdue task is measured, not merely flagged", () => {
  const { universe, advice } = build({
    tasks: [task("t1", "Late", null, { dueDate: ts(-3 * DAY) })],
  });

  const out = adviceFor(universe, universe.byId.get("task:t1")!, advice);
  const overdue = out.find((a) => a.id === "task-overdue");
  assert.ok(overdue);
  assert.match(overdue!.text, /3 days/);
});

test("a finished task is not nagged about its deadline", () => {
  const { universe, advice } = build({
    tasks: [task("t1", "Late but done", null, { dueDate: ts(-3 * DAY), status: "done" })],
  });

  const out = adviceFor(universe, universe.byId.get("task:t1")!, advice);
  assert.ok(!out.some((a) => a.id === "task-overdue"));
});

test("a contact attached to nothing is called out, one attached to work is counted", () => {
  const loose = build({ people: [person("pe1", "Ahmed")] });
  assert.ok(
    adviceFor(loose.universe, loose.universe.byId.get("person:pe1")!, loose.advice).some(
      (a) => a.id === "person-idle"
    )
  );

  const busy = build({
    people: [person("pe1", "Ahmed")],
    tasks: [task("t1", "Call Ahmed about pricing", null)],
  });
  const out = adviceFor(busy.universe, busy.universe.byId.get("person:pe1")!, busy.advice);
  const open = out.find((a) => a.id === "person-open");
  assert.ok(open, "the inferred link counts as live work");
  assert.equal(open!.go, "task:t1");
});

test("nothing is ever said about a record the workspace has no facts for", () => {
  const { universe, advice } = build({});
  const out = adviceFor(universe, universe.byId.get(OWNER_ID)!, advice);
  assert.deepEqual(out, [], "an empty workspace produces no observations");
});

test("at most three observations survive, strongest first", () => {
  const { universe, advice } = build({
    projects: [project("p1", "Alpha", { progress: 0, updatedAt: ts(-40 * DAY) })],
    tasks: [
      task("t1", "Blocked", "p1", { status: "blocked" }),
      task("t2", "Done", "p1", { status: "done" }),
      task("t3", "Done too", "p1", { status: "done" }),
    ],
  });

  const out = adviceFor(universe, universe.byId.get("project:p1")!, advice);
  assert.ok(out.length <= 3);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].weight >= out[i].weight, "ordered by signal strength");
  }
});
