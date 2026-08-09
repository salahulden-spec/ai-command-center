import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { generateText } from "ai";
import { Resend } from "resend";

initializeApp();
const db = getFirestore();

// Vercel's Fluid Compute/OIDC auth doesn't apply outside Vercel — Cloud
// Functions authenticates to the AI Gateway with the same static
// AI_GATEWAY_API_KEY already used locally, stored as a Firebase secret
// (`firebase functions:secrets:set AI_GATEWAY_API_KEY`) and bound per
// function below so it lands in process.env at runtime.
const AI_GATEWAY_API_KEY = defineSecret("AI_GATEWAY_API_KEY");

// Set via `firebase functions:secrets:set RESEND_API_KEY` with a Resend
// (resend.com) API key. Sending "from" the default onboarding@resend.dev
// address works without verifying a domain, fine for this single-user app's
// volume — swap in a verified custom domain in Resend later if desired.
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const REMINDER_EMAIL = "salahulden@gmail.com";

/**
 * The owner's own zone, mirroring ASSISTANT_TIMEZONE in the web app's env.
 *
 * Cloud Functions run in UTC, so anything formatted with a bare
 * `toLocaleString()` states a time the owner never asked for — a reminder due
 * at 9am read "Due: 5:00 AM" in the email that delivered it. It is a literal
 * rather than a param because `onSchedule`'s `timeZone` is resolved at deploy
 * time, and because a wrong-but-silent default is the failure being fixed
 * here. Keep it in step with ASSISTANT_TIMEZONE.
 */
const TIME_ZONE = "Asia/Muscat";

/** The owner's wall clock, not the container's. */
function inOwnerZone(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The owner's calendar date. Muscat is four hours ahead of the container, so
 * for the last four hours of every day a UTC `toDateString()` names yesterday
 * — and a briefing that opens with the wrong date is worse than one with none.
 */
function ownerDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: TIME_ZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

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
      notifiedAt: null,
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

/**
 * Runs every minute: finds pending reminders whose dueAt has passed and
 * that haven't been emailed yet, and sends one email per reminder via
 * Resend.
 *
 * The poll interval is the delivery error. At five minutes, a reminder set for
 * 9:00 arrived any time up to 9:05 — close enough to look like a bug and
 * impossible to tell apart from one. A minute is the finest `onSchedule`
 * offers, and the query is a single equality read on a collection this app
 * will never fill, so the extra runs cost effectively nothing.
 *
 * `notifiedAt` (set right after a successful send) is what stops a
 * reminder from being emailed again on the next poll — status stays
 * "pending" until the user marks it done themselves, since receiving the
 * email isn't the same as having handled it.
 *
 * A plain equality-only query (status == "pending") avoids needing a
 * composite index — the dueAt/notifiedAt filtering happens in memory,
 * same approach as weeklyReview below.
 */
export const sendDueReminderEmails = onSchedule(
  { schedule: "every 1 minutes", region: FUNCTION_REGION, secrets: [RESEND_API_KEY] },
  async () => {
    const now = Timestamp.now();
    const pendingSnap = await db.collection("reminders").where("status", "==", "pending").get();
    const due = pendingSnap.docs.filter((snap) => {
      const data = snap.data();
      const notifiedAt = data.notifiedAt as Timestamp | null | undefined;
      const dueAt = data.dueAt as Timestamp | undefined;
      return notifiedAt == null && dueAt != null && dueAt.toMillis() <= now.toMillis();
    });

    if (due.length === 0) return;

    const resend = new Resend(process.env.RESEND_API_KEY);

    for (const snap of due) {
      const text = snap.data().text as string;
      try {
        await resend.emails.send({
          from: "AI Command Center <onboarding@resend.dev>",
          to: REMINDER_EMAIL,
          subject: `Reminder: ${text}`,
          text: `${text}\n\nDue: ${inOwnerZone((snap.data().dueAt as Timestamp).toDate())}`,
        });
        await snap.ref.update({ notifiedAt: FieldValue.serverTimestamp() });
      } catch (err) {
        console.error(`Failed to send reminder email for ${snap.id}:`, err);
      }
    }
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
 * Runs every day at 7am, the owner's time. Pulls today's open tasks, pending
 * reminders, and active projects, then asks the model to write a short morning
 * briefing.
 *
 * It used to run at 7am America/New_York, which is mid-afternoon in Muscat —
 * a "morning briefing" that arrived after the day it was briefing about.
 */
export const dailyBriefing = onSchedule(
  {
    schedule: "0 7 * * *",
    timeZone: TIME_ZONE,
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
        .map((d) => `- ${d.data().text} (due ${inOwnerZone((d.data().dueAt as Timestamp).toDate())})`)
        .join("\n") || "(none)";
    const projectLines =
      activeProjectsSnap.docs.map((d) => `- ${d.data().name}: ${d.data().progress ?? 0}% complete`).join("\n") ||
      "(none)";

    const { text } = await generateText({
      model: "anthropic/claude-sonnet-4.6",
      system:
        "You write a short, practical morning briefing for a single user's personal AI operating system. Be concise — a few sentences plus short bullet highlights, not an exhaustive list. Prioritize what matters most today. Plain, direct tone, no fluff.",
      prompt: `Today's date: ${ownerDate(new Date())}\n\nOpen tasks:\n${taskLines}\n\nPending reminders:\n${reminderLines}\n\nActive projects:\n${projectLines}\n\nWrite today's briefing.`,
    });

    await saveBriefing("daily", text);
  }
);

/**
 * Runs every Monday at 8am, the owner's time. Reviews what actually happened in
 * the last 7 days (completed tasks, decisions, research) rather than what's
 * pending.
 */
export const weeklyReview = onSchedule(
  {
    schedule: "0 8 * * 1",
    timeZone: TIME_ZONE,
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
      prompt: `Week ending: ${ownerDate(new Date())}\n\nTasks completed this week:\n${doneLines}\n\nDecisions made this week:\n${decisionLines}\n\nResearch logged this week:\n${researchLines}\n\nActive projects:\n${projectLines}\n\nWrite this week's review.`,
    });

    await saveBriefing("weekly", text);
  }
);
