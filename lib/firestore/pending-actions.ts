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
import { createMemory } from "./memory";
import { createDecision } from "./decisions";
import { createResearchEntry } from "./research";
import { createFiledDocument } from "./documents";
import type { MemoryType, DecisionOption, DocumentEntities } from "@/types";

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
    case "saveMemory": {
      const { type, content, embedding } = action.payload as {
        type: MemoryType;
        content: string;
        embedding: number[];
      };
      await createMemory({ type, content, embedding, source: "ai" });
      break;
    }
    case "saveDecision": {
      const { projectId, question, options, recommended, reasoning, confidence } =
        action.payload as {
          projectId: string;
          question: string;
          options: DecisionOption[];
          recommended: string;
          reasoning: string;
          confidence: number;
        };
      await createDecision(projectId, { question, options, recommended, reasoning, confidence });
      break;
    }
    case "saveResearch": {
      const { projectId, title, content, links, tags } = action.payload as {
        projectId: string;
        title: string;
        content: string;
        links?: string[];
        tags?: string[];
      };
      await createResearchEntry(projectId, { title, content, links, tags });
      break;
    }
    case "saveDocument": {
      const { projectId, fileName, summary, entities } = action.payload as {
        projectId: string;
        fileName: string;
        summary: string;
        entities: DocumentEntities;
      };
      await createFiledDocument(projectId, { fileName, summary, entities });
      break;
    }
  }
  return deleteDoc(doc(db, "pendingActions", action.id));
}

export async function rejectPendingAction(actionId: string) {
  return deleteDoc(doc(db, "pendingActions", actionId));
}
