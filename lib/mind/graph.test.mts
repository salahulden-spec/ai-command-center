import test from "node:test";
import assert from "node:assert/strict";
import { buildMindGraph, isPersonMention, type MindGraphInput } from "./graph.ts";

/**
 * Run with `npm test`. Uses Node's built-in runner and type stripping, so there
 * is no test framework to install — `graph.ts` imports only types at runtime,
 * which the stripper erases along with the `@/types` path alias.
 */

// Firestore Timestamps are only ever read through the graph builder's own
// field access, so a structural stand-in is enough here.
const ts = { toDate: () => new Date(), toMillis: () => 0 } as never;

const project = (id: string, name: string) =>
  ({
    id,
    name,
    description: "",
    status: "active",
    objectives: [],
    progress: 50,
    createdAt: ts,
    updatedAt: ts,
  }) as never;

const task = (id: string, title: string, projectId: string | null) =>
  ({
    id,
    title,
    description: "",
    status: "todo",
    priority: "medium",
    dueDate: null,
    projectId,
    source: "manual",
    createdAt: ts,
    updatedAt: null,
  }) as never;

const person = (id: string, name: string) =>
  ({ id, name, company: "", notes: "", createdAt: ts }) as never;

const documentNamed = (id: string, projectId: string, people: string[]) =>
  ({
    id,
    projectId,
    data: {
      id,
      fileName: "spec.pdf",
      fileType: "",
      storagePath: "",
      status: "done",
      extractedSummary: "",
      extractedEntities: { dates: [], people, companies: [], tasks: [] },
      createdAt: ts,
    },
  }) as never;

const empty: MindGraphInput = {
  projects: [],
  tasks: [],
  people: [],
  reminders: [],
  documents: [],
  research: [],
  decisions: [],
};

test("isPersonMention matches names tolerantly but not coincidentally", () => {
  assert.ok(isPersonMention("Salah Ahmed", "Salah Ahmed"));
  assert.ok(isPersonMention("  salah   ahmed ", "Salah Ahmed"), "case and spacing insensitive");
  assert.ok(isPersonMention("Dr. Salah Ahmed", "Salah Ahmed"), "name embedded in a longer mention");

  assert.ok(!isPersonMention("Alex Kim", "Al"), "short names must not match by substring");
  assert.ok(!isPersonMention("Jane Doe", "Salah Ahmed"));
  assert.ok(!isPersonMention("", "Salah Ahmed"));
});

test("a task linked to a project produces one belongsTo edge", () => {
  const graph = buildMindGraph({
    ...empty,
    projects: [project("p1", "Alpha")],
    tasks: [task("t1", "Do it", "p1")],
  });

  assert.equal(graph.nodes.length, 2);
  assert.deepEqual(graph.links, [
    { source: "task-t1", target: "project-p1", kind: "belongsTo" },
  ]);
  assert.equal(graph.nodes.find((n) => n.id === "project-p1")?.degree, 1);
});

test("records with no project attach to the Unfiled hub", () => {
  const orphaned = buildMindGraph({ ...empty, tasks: [task("t1", "Loose", null)] });
  assert.ok(orphaned.nodes.some((n) => n.id === "unfiled"));
  assert.equal(orphaned.links[0].target, "unfiled");

  const filed = buildMindGraph({
    ...empty,
    projects: [project("p1", "Alpha")],
    tasks: [task("t1", "Filed", "p1")],
  });
  assert.ok(!filed.nodes.some((n) => n.id === "unfiled"), "no hub when nothing is orphaned");
});

test("a projectId pointing at a deleted project never yields a dangling edge", () => {
  // d3-force throws if a link references a node id that doesn't exist, so this
  // is what stops a stale reference from taking the whole page down.
  const graph = buildMindGraph({ ...empty, tasks: [task("t1", "Ghost", "deleted-project")] });
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const link of graph.links) {
    assert.ok(ids.has(link.source), `missing source ${link.source}`);
    assert.ok(ids.has(link.target), `missing target ${link.target}`);
  }
});

test("a record whose project no longer exists is dropped, not filed under Unfiled", () => {
  // This workspace really did accumulate tasks written to projects/{name}/tasks
  // and projects/{hallucinated-slug}/tasks. Firestore creates subcollections
  // under missing parents without complaint, so these look fine in the database
  // and are unreachable from anywhere. Showing them under "Unfiled" dressed a
  // broken reference up as a deliberate one.
  const graph = buildMindGraph({ ...empty, tasks: [task("t1", "Ghost", "deleted-project")] });

  assert.equal(graph.nodes.length, 0, "the orphan contributes no node");
  assert.equal(graph.links.length, 0);
  assert.ok(!graph.nodes.some((n) => n.id === "unfiled"), "and no hub is invented for it");
});

test("completed work is left out of the live picture", () => {
  const done = {
    id: "t1",
    title: "Finished",
    description: "",
    status: "done",
    priority: "medium",
    dueDate: null,
    projectId: null,
    source: "manual",
    createdAt: ts,
    updatedAt: null,
  } as never;
  const graph = buildMindGraph({ ...empty, tasks: [done] });
  assert.equal(graph.nodes.length, 0, "a done task is history, not part of the graph");

  const doneReminder = {
    id: "r1",
    text: "Eat lunch",
    dueAt: ts,
    status: "done",
    relatedProjectId: null,
    notifiedAt: null,
    createdAt: ts,
  } as never;
  assert.equal(buildMindGraph({ ...empty, reminders: [doneReminder] }).nodes.length, 0);
});

test("a task naming a contact links them, so People are not isolated dots", () => {
  const graph = buildMindGraph({
    ...empty,
    people: [person("pe1", "Kutty"), person("pe2", "Tareq")],
    tasks: [task("t1", "Send email to Kutty about the quotation", null)],
  });

  const mentions = graph.links.filter((l) => l.kind === "mentions");
  assert.deepEqual(mentions, [{ source: "task-t1", target: "person-pe1", kind: "mentions" }]);
  assert.equal(graph.nodes.find((n) => n.id === "person-pe2")?.degree, 0);
});

test("mention matching needs a whole word, not any substring", () => {
  const graph = buildMindGraph({
    ...empty,
    people: [person("pe1", "Ali")],
    // "quality" contains "ali"; a naive includes() would link them.
    tasks: [task("t1", "Review the quality report", null)],
  });
  assert.equal(graph.links.filter((l) => l.kind === "mentions").length, 0);
});

test("a document naming a saved contact bridges People into the graph", () => {
  const graph = buildMindGraph({
    ...empty,
    projects: [project("p1", "Alpha")],
    people: [person("pe1", "Salah Ahmed"), person("pe2", "Nobody Mentioned")],
    documents: [documentNamed("d1", "p1", ["Salah Ahmed"])],
  });

  const mentions = graph.links.filter((l) => l.kind === "mentions");
  assert.deepEqual(mentions, [
    { source: "document-d1", target: "person-pe1", kind: "mentions" },
  ]);
  assert.equal(
    graph.nodes.find((n) => n.id === "person-pe2")?.degree,
    0,
    "an unmentioned contact stays unconnected rather than being linked speculatively"
  );
  assert.ok(
    graph.links.some(
      (l) => l.kind === "belongsTo" && l.source === "document-d1" && l.target === "project-p1"
    ),
    "the document still belongs to its project"
  );
});
