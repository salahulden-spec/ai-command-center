import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  serverTimestamp,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { Task, TaskStatus, TaskPriority } from "@/types";

const converter = makeConverter<Task>();

function tasksCollection(projectId: string | null) {
  return projectId
    ? collection(db, "projects", projectId, "tasks").withConverter(converter)
    : collection(db, "tasks").withConverter(converter);
}

export function tasksQuery(projectId: string | null) {
  return query(tasksCollection(projectId), orderBy("createdAt", "desc"));
}

/**
 * All tasks across standalone + every project's subcollection.
 * No orderBy here — a collectionGroup query with orderBy needs a
 * manually-created composite index; sort client-side instead.
 */
export function allTasksQuery() {
  return query(collectionGroup(db, "tasks").withConverter(converter));
}

export async function createTask(input: {
  title: string;
  projectId: string | null;
  priority?: TaskPriority;
}) {
  return addDoc(tasksCollection(input.projectId), {
    id: "",
    title: input.title,
    description: "",
    status: "todo" as TaskStatus,
    priority: input.priority ?? "medium",
    dueDate: null,
    projectId: input.projectId,
    source: "manual",
    createdAt: serverTimestamp(),
  } as unknown as Task);
}

export async function updateTaskStatus(
  projectId: string | null,
  taskId: string,
  status: TaskStatus
) {
  return updateDoc(doc(tasksCollection(projectId), taskId), { status });
}

export async function deleteTask(projectId: string | null, taskId: string) {
  return deleteDoc(doc(tasksCollection(projectId), taskId));
}

/** All open (not done) tasks across standalone + every project, for the AI to reference. */
export async function listOpenTasksOnce() {
  const snap = await getDocs(allTasksQuery());
  return snap.docs
    .map((d) => d.data())
    .filter((t) => t.status !== "done");
}
