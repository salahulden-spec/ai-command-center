import { adminDb } from "@/lib/firebase/admin";
import type { Timestamp } from "firebase-admin/firestore";

/**
 * Caps on how much state gets inlined into the system prompt. Generous enough
 * that a single-user workspace fits entirely, small enough that the prompt
 * stays cheap. Anything truncated is still reachable via the list* tools.
 */
const CAP = { projects: 40, tasks: 60, reminders: 25, people: 40 } as const;

/**
 * Reads the workspace state the assistant almost always needs and formats it
 * for the system prompt.
 *
 * The point is latency, not convenience. Without this the model has to spend a
 * whole round trip on listProjects before it can attach a task to a project,
 * and another on listOpenTasks before it can complete one — each round trip is
 * seconds of silence for someone waiting on a text reply. These four reads run
 * in parallel and cost ~100ms total, so the common commands ("add X to project
 * Y", "mark Z done") resolve in a single model call with the real IDs already
 * in hand.
 */
export async function loadWorkspaceSnapshot(timeZone: string): Promise<string> {
  const db = adminDb();
  const [projectsSnap, tasksSnap, remindersSnap, peopleSnap, inboxSnap] = await Promise.all([
    db.collection("projects").get(),
    db.collectionGroup("tasks").get(),
    db.collection("reminders").where("status", "==", "pending").get(),
    db.collection("people").get(),
    db.collection("inbox").where("status", "==", "unprocessed").get(),
  ]);

  const projects = projectsSnap.docs
    .filter((d) => d.data().status !== "archived")
    .slice(0, CAP.projects)
    .map((d) => `  - ${d.data().name} [${d.data().status}] id=${d.id}`);

  const openTasks = tasksSnap.docs
    .filter((d) => d.data().status !== "done")
    .slice(0, CAP.tasks)
    .map((d) => {
      // Derived from the document path rather than the stored `projectId`
      // field: the path is always right, the field can be missing on older
      // documents written before it existed.
      const projectId = d.ref.parent.parent?.id ?? null;
      const data = d.data();
      const where = projectId ? ` project=${projectId}` : "";
      return `  - ${data.title} [${data.status}/${data.priority ?? "medium"}] id=${d.id}${where}`;
    });

  const reminders = remindersSnap.docs.slice(0, CAP.reminders).map((d) => {
    const data = d.data();
    const due = (data.dueAt as Timestamp | undefined)
      ?.toDate()
      .toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });
    return `  - ${data.text} (due ${due ?? "unknown"}) id=${d.id}`;
  });

  const people = peopleSnap.docs
    .slice(0, CAP.people)
    .map((d) => `  - ${d.data().name}${d.data().company ? ` (${d.data().company})` : ""} id=${d.id}`);

  return [
    section("PROJECTS", projects, "none yet"),
    section("OPEN TASKS", openTasks, "none"),
    section("PENDING REMINDERS", reminders, "none"),
    section("PEOPLE", people, "none"),
    `UNPROCESSED INBOX ITEMS: ${inboxSnap.size}`,
  ].join("\n");
}

function section(title: string, lines: string[], empty: string): string {
  return lines.length ? `${title}:\n${lines.join("\n")}` : `${title}: ${empty}`;
}
