import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOsTree,
  layoutRadial,
  textMentionsPerson,
  type OsGraphInput,
} from "./os-graph.ts";

const NOW = new Date("2026-08-02T12:00:00Z");
const ts = (offsetMs = 0) =>
  ({ toDate: () => new Date(NOW.getTime() + offsetMs), toMillis: () => NOW.getTime() + offsetMs }) as never;

const project = (id: string, name: string, status = "active", description = "") =>
  ({ id, name, description, status, objectives: [], progress: 40, createdAt: ts(), updatedAt: ts() }) as never;

const task = (
  id: string,
  title: string,
  projectId: string | null,
  extra: Record<string, unknown> = {}
) =>
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

const base: OsGraphInput = {
  ownerName: "Salah",
  projects: [],
  tasks: [],
  people: [],
  reminders: [],
  links: [],
  unprocessedInboxCount: 0,
  now: NOW,
};

test("the owner is the root and hubs only exist for non-empty categories", () => {
  const { root } = buildOsTree({ ...base, projects: [project("p1", "Vendor Passport")] });
  assert.equal(root.kind, "owner");
  assert.equal(root.label, "Salah");
  assert.deepEqual(
    root.children.map((c) => c.id),
    ["hub-projects"],
    "no People/Tasks/Reminders hubs when those are empty"
  );
});

test("a project's open tasks are its children; done tasks are excluded everywhere", () => {
  const { root } = buildOsTree({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: [task("t1", "Open item", "p1"), task("t2", "Finished", "p1", { status: "done" })],
  });
  const projectNode = root.children[0].children[0];
  assert.deepEqual(
    projectNode.children.map((c) => c.id),
    ["task-t1"]
  );
});

test("overdue and high-priority work turns red and bubbles up as alerts", () => {
  const { root } = buildOsTree({
    ...base,
    projects: [project("p1", "Alpha")],
    tasks: [task("t1", "Late", "p1", { dueDate: ts(-60_000) })],
  });
  const hub = root.children[0];
  assert.equal(hub.children[0].children[0].status, "red");
  assert.equal(hub.children[0].alerts, 1, "project counts its red children");
  assert.ok(root.alerts >= 1, "the alert is visible from the centre");
});

test("explicit links and name inference both produce cross-edges, deduplicated", () => {
  const { crossEdges } = buildOsTree({
    ...base,
    people: [person("pe1", "Ahmed")],
    tasks: [task("t1", "Call Ahmed about the quotation", null)],
    links: [
      { id: "l1", sourceType: "person", sourceId: "pe1", targetType: "task", targetId: "t1", createdAt: ts() } as never,
    ],
  });
  assert.equal(crossEdges.length, 1, "the explicit link and the inferred mention collapse into one edge");
  assert.deepEqual(crossEdges[0], { a: "person-pe1", b: "task-t1" });
});

test("mention inference needs a whole word", () => {
  assert.ok(textMentionsPerson("Call Ahmed today", "Ahmed"));
  assert.ok(!textMentionsPerson("Review the quality report", "Ali"));
});

test("layout only descends into expanded nodes and never overlaps siblings", () => {
  const { root } = buildOsTree({
    ...base,
    projects: [project("p1", "Alpha"), project("p2", "Beta")],
    tasks: [task("t1", "Inside", "p1")],
    people: [person("pe1", "Ahmed")],
  });

  const collapsed = layoutRadial(root, new Set(["owner"]));
  assert.deepEqual(
    collapsed.map((p) => p.node.id).sort(),
    ["hub-people", "hub-projects", "owner"],
    "hubs visible, their children hidden until expanded"
  );

  const expanded = layoutRadial(root, new Set(["owner", "hub-projects", "project-p1"]));
  const ids = expanded.map((p) => p.node.id);
  assert.ok(ids.includes("task-t1"), "expanding a project reveals its tasks");
  assert.ok(ids.includes("hub-people"), "collapsed hubs stay visible");
  assert.ok(!ids.includes("person-pe1"), "a collapsed hub's children stay hidden");

  // No two placed nodes share a position.
  const seen = new Set<string>();
  for (const p of expanded) {
    const key = `${Math.round(p.x)},${Math.round(p.y)}`;
    assert.ok(!seen.has(key), `overlap at ${key}`);
    seen.add(key);
  }

  const owner = expanded.find((p) => p.node.id === "owner");
  assert.deepEqual({ x: owner?.x, y: owner?.y }, { x: 0, y: 0 }, "the owner anchors the centre");
});
