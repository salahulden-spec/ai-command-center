import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

initializeApp();
const db = getFirestore();

// Firestore triggers (Eventarc) aren't supported in me-central2, the region
// this project's Firestore database lives in — real-time Firestore-triggered
// functions simply cannot be created against this database. Polling on a
// schedule sidesteps that entirely: the function just queries Firestore
// directly rather than subscribing to a region-bound trigger. us-central1 is
// the widest-supported, cheapest Cloud Functions region; the poll itself
// reads/writes Firestore over the network regardless of function region.
const FUNCTION_REGION = "us-central1";
const POLL_STATE_DOC = db.collection("system").doc("automationPollState");

type WorkflowStep =
  | { type: "createTask"; title: string; projectId: string | null }
  | { type: "createReminder"; text: string; delayMinutes: number };

interface Workflow {
  enabled: boolean;
  trigger: { collection: "tasks"; event: "statusChanged"; toStatus: string };
  steps: WorkflowStep[];
}

function fillTemplate(template: string, doc: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(doc[key] ?? ""));
}

async function runStep(step: WorkflowStep, triggerDoc: Record<string, unknown>) {
  if (step.type === "createTask") {
    const collectionRef = step.projectId
      ? db.collection("projects").doc(step.projectId).collection("tasks")
      : db.collection("tasks");
    await collectionRef.add({
      title: fillTemplate(step.title, triggerDoc),
      description: "",
      status: "todo",
      priority: "medium",
      dueDate: null,
      projectId: step.projectId,
      source: "ai",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: null,
    });
  } else if (step.type === "createReminder") {
    const dueAt = new Date(Date.now() + step.delayMinutes * 60_000);
    await db.collection("reminders").add({
      text: fillTemplate(step.text, triggerDoc),
      dueAt,
      status: "pending",
      relatedProjectId: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

/**
 * Runs every 2 minutes: finds tasks whose status changed to a watched value
 * since the last poll, and fires the matching enabled workflows' steps.
 * `updatedAt` (set by every status-changing write) is what makes "changed
 * since last poll" detectable without a Firestore trigger.
 */
export const pollTaskWorkflows = onSchedule(
  { schedule: "every 2 minutes", region: FUNCTION_REGION },
  async () => {
    const stateSnap = await POLL_STATE_DOC.get();
    const lastPolledAt = (stateSnap.data()?.lastPolledAt as Timestamp | undefined) ?? Timestamp.fromMillis(0);
    const pollStartedAt = Timestamp.now();

    const workflowsSnap = await db.collection("workflows").where("enabled", "==", true).get();
    const enabledWorkflows = workflowsSnap.docs.map((snap) => snap.data() as Workflow);
    const watchedStatuses = [
      ...new Set(
        enabledWorkflows
          .filter((w) => w.trigger?.collection === "tasks" && w.trigger?.event === "statusChanged")
          .map((w) => w.trigger.toStatus)
      ),
    ];

    if (watchedStatuses.length === 0) {
      await POLL_STATE_DOC.set({ lastPolledAt: pollStartedAt });
      return;
    }

    for (const status of watchedStatuses) {
      // collectionGroup("tasks") already covers both the standalone tasks
      // collection and every project's tasks subcollection — a collection
      // group query matches any collection with that ID, at any depth,
      // including the root-level one.
      const tasksSnap = await db.collectionGroup("tasks").where("status", "==", status).get();
      const changedTasks = tasksSnap.docs.filter((snap) => {
        const updatedAt = snap.data().updatedAt as Timestamp | null | undefined;
        return updatedAt != null && updatedAt.toMillis() > lastPolledAt.toMillis();
      });

      const matchingWorkflows = enabledWorkflows.filter(
        (w) => w.trigger?.collection === "tasks" && w.trigger?.event === "statusChanged" && w.trigger?.toStatus === status
      );

      for (const taskSnap of changedTasks) {
        const taskData = taskSnap.data();
        for (const workflow of matchingWorkflows) {
          for (const step of workflow.steps ?? []) {
            await runStep(step, taskData);
          }
        }
      }
    }

    await POLL_STATE_DOC.set({ lastPolledAt: pollStartedAt });
  }
);
