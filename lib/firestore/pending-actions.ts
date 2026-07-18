import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  serverTimestamp,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { PendingAction, PendingActionType } from "@/types";
import { createProject } from "./projects";
import { createTask, updateTaskStatus } from "./tasks";
import { createReminder, markReminderDone } from "./reminders";

const converter = makeConverter<PendingAction>();

export function pendingActionsQuery() {
  return query(
    collection(db, "pendingActions").withConverter(converter),
    where("status", "==", "pending"),
    orderBy("createdAt", "desc")
  );
}

export async function queuePendingAction(
  actionType: PendingActionType,
  summary: string,
  payload: Record<string, unknown>
) {
  return addDoc(collection(db, "pendingActions").withConverter(converter), {
    id: "",
    actionType,
    summary,
    payload,
    status: "pending",
    createdAt: serverTimestamp(),
  } as unknown as PendingAction);
}

export async function approvePendingAction(action: PendingAction) {
  switch (action.actionType) {
    case "createProject":
      await createProject(action.payload as { name: string; description: string });
      break;
    case "createTask":
      await createTask(
        action.payload as { title: string; projectId: string | null }
      );
      break;
    case "createReminder": {
      const { text, dueAt } = action.payload as { text: string; dueAt: string };
      await createReminder({ text, dueAt: new Date(dueAt) });
      break;
    }
    case "completeTask": {
      const { taskId, projectId } = action.payload as {
        taskId: string;
        projectId: string | null;
      };
      await updateTaskStatus(projectId, taskId, "done");
      break;
    }
    case "completeReminder": {
      const { reminderId } = action.payload as { reminderId: string };
      await markReminderDone(reminderId);
      break;
    }
  }
  return deleteDoc(doc(db, "pendingActions", action.id));
}

export async function rejectPendingAction(actionId: string) {
  return deleteDoc(doc(db, "pendingActions", actionId));
}
