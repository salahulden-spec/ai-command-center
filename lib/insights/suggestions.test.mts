import test from "node:test";
import assert from "node:assert/strict";
import { buildSuggestions, type SuggestionsInput } from "./suggestions.ts";

const NOW = new Date("2026-08-02T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ts = (offsetMs = 0) =>
  ({ toDate: () => new Date(NOW.getTime() + offsetMs), toMillis: () => NOW.getTime() + offsetMs }) as never;

const base: SuggestionsInput = {
  projects: [],
  tasks: [],
  reminders: [],
  people: [],
  inbox: [],
  now: NOW,
};

const task = (id: string, extra: Record<string, unknown>) =>
  ({
    id,
    title: `Task ${id}`,
    description: "",
    status: "todo",
    priority: "medium",
    dueDate: null,
    projectId: null,
    source: "manual",
    createdAt: ts(-10 * DAY),
    updatedAt: null,
    ...extra,
  }) as never;

test("an overdue task is urgent and sorts before everything else", () => {
  const out = buildSuggestions({
    ...base,
    tasks: [
      task("t1", { dueDate: ts(-2 * DAY) }),
      task("t2", { status: "blocked" }),
    ],
  });
  assert.equal(out[0].severity, "urgent");
  assert.match(out[0].text, /overdue/);
  assert.ok(out.some((s) => s.id === "blocked-tasks"));
});

test("an active project with no open tasks is flagged as having no next step", () => {
  const out = buildSuggestions({
    ...base,
    projects: [
      {
        id: "p1",
        name: "Vendor Passport",
        description: "",
        status: "active",
        objectives: [],
        progress: 10,
        createdAt: ts(-30 * DAY),
        updatedAt: ts(-1 * DAY),
      } as never,
    ],
  });
  assert.ok(out.some((s) => s.id === "no-next-step-p1"));
  assert.ok(!out.some((s) => s.id === "stale-project-p1"), "updated yesterday, so not stale");
});

test("a week of silence on an active project is called out; done tasks never trigger anything", () => {
  const out = buildSuggestions({
    ...base,
    projects: [
      {
        id: "p1",
        name: "Quiet",
        description: "",
        status: "active",
        objectives: [],
        progress: 50,
        createdAt: ts(-40 * DAY),
        updatedAt: ts(-9 * DAY),
      } as never,
    ],
    tasks: [task("t1", { projectId: "p1", status: "done", dueDate: ts(-5 * DAY) })],
  });
  assert.ok(out.some((s) => s.id === "stale-project-p1"));
  assert.ok(!out.some((s) => s.severity === "urgent"), "a done task is never overdue");
});

test("a calm workspace produces no noise", () => {
  const out = buildSuggestions({
    ...base,
    tasks: [task("t1", { updatedAt: ts(-1 * DAY) })],
  });
  assert.deepEqual(out, []);
});
