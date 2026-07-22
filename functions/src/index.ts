import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { generateText } from "ai";

initializeApp();
const db = getFirestore();

// Vercel's Fluid Compute/OIDC auth doesn't apply outside Vercel — Cloud
// Functions authenticates to the AI Gateway with the same static
// AI_GATEWAY_API_KEY already used locally, stored as a Firebase secret
// (`firebase functions:secrets:set AI_GATEWAY_API_KEY`) and bound per
// function below so it lands in process.env at runtime.
const AI_GATEWAY_API_KEY = defineSecret("AI_GATEWAY_API_KEY");

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

async function saveBriefing(type: "daily" | "weekly", content: string) {
  await db.collection("briefings").add({
    type,
    content,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Runs every day at 7am ET. Pulls today's open tasks, pending reminders, and
 * active projects, then asks the model to write a short morning briefing.
 * Adjust the `schedule`/`timeZone` below if 7am ET isn't the right time —
 * this was a reasonable default, not a confirmed user preference.
 */
export const dailyBriefing = onSchedule(
  {
    schedule: "0 7 * * *",
    timeZone: "America/New_York",
    region: FUNCTION_REGION,
    secrets: [AI_GATEWAY_API_KEY],
    timeoutSeconds: 120,
  },
  async () => {
    const [openTasksSnap, pendingRemindersSnap, activeProjectsSnap] = await Promise.all([
      db.collectionGroup("tasks").where("status", "==", "todo").get(),
      db.collection("reminders").where("status", "==", "pending").get(),
      db.collection("projects").where("status", "==", "active").get(),
    ]);

    const taskLines = openTasksSnap.docs.map((d) => `- ${d.data().title}`).join("\n") || "(none)";
    const reminderLines =
      pendingRemindersSnap.docs
        .map((d) => `- ${d.data().text} (due ${(d.data().dueAt as Timestamp).toDate().toLocaleString()})`)
        .join("\n") || "(none)";
    const projectLines =
      activeProjectsSnap.docs.map((d) => `- ${d.data().name}: ${d.data().progress ?? 0}% complete`).join("\n") ||
      "(none)";

    const { text } = await generateText({
      model: "anthropic/claude-sonnet-4.6",
      system:
        "You write a short, practical morning briefing for a single user's personal AI operating system. Be concise — a few sentences plus short bullet highlights, not an exhaustive list. Prioritize what matters most today. Plain, direct tone, no fluff.",
      prompt: `Today's date: ${new Date().toDateString()}\n\nOpen tasks:\n${taskLines}\n\nPending reminders:\n${reminderLines}\n\nActive projects:\n${projectLines}\n\nWrite today's briefing.`,
    });

    await saveBriefing("daily", text);
  }
);

/**
 * Runs every Monday at 8am ET. Reviews what actually happened in the last 7
 * days (completed tasks, decisions, research) rather than what's pending.
 */
export const weeklyReview = onSchedule(
  {
    schedule: "0 8 * * 1",
    timeZone: "America/New_York",
    region: FUNCTION_REGION,
    secrets: [AI_GATEWAY_API_KEY],
    timeoutSeconds: 120,
  },
  async () => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Plain collectionGroup reads (no where filter) don't need a composite
    // index — filtering by date happens in memory instead.
    const [doneTasksSnap, decisionsSnap, researchSnap, activeProjectsSnap] = await Promise.all([
      db.collectionGroup("tasks").where("status", "==", "done").get(),
      db.collectionGroup("decisions").get(),
      db.collectionGroup("research").get(),
      db.collection("projects").where("status", "==", "active").get(),
    ]);

    const recentlyDone = doneTasksSnap.docs.filter((d) => {
      const updatedAt = d.data().updatedAt as Timestamp | null | undefined;
      return updatedAt != null && updatedAt.toMillis() > weekAgo;
    });
    const recentDecisions = decisionsSnap.docs.filter(
      (d) => ((d.data().decidedAt as Timestamp | undefined)?.toMillis() ?? 0) > weekAgo
    );
    const recentResearch = researchSnap.docs.filter(
      (d) => ((d.data().createdAt as Timestamp | undefined)?.toMillis() ?? 0) > weekAgo
    );

    const doneLines = recentlyDone.map((d) => `- ${d.data().title}`).join("\n") || "(none)";
    const decisionLines =
      recentDecisions.map((d) => `- ${d.data().question} → ${d.data().recommended}`).join("\n") || "(none)";
    const researchLines = recentResearch.map((d) => `- ${d.data().title}`).join("\n") || "(none)";
    const projectLines =
      activeProjectsSnap.docs.map((d) => `- ${d.data().name}: ${d.data().progress ?? 0}% complete`).join("\n") ||
      "(none)";

    const { text } = await generateText({
      model: "anthropic/claude-sonnet-4.6",
      system:
        "You write a short weekly review for a single user's personal AI operating system, looking back at the past 7 days. Highlight what got done, notable decisions, and active project momentum. A few short paragraphs or bullet groups, not exhaustive. Plain, direct tone.",
      prompt: `Week ending: ${new Date().toDateString()}\n\nTasks completed this week:\n${doneLines}\n\nDecisions made this week:\n${decisionLines}\n\nResearch logged this week:\n${researchLines}\n\nActive projects:\n${projectLines}\n\nWrite this week's review.`,
    });

    await saveBriefing("weekly", text);
  }
);
