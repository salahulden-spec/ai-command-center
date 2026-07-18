import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { Project, ProjectStatus } from "@/types";

const converter = makeConverter<Project>();

export function projectsQuery() {
  return query(
    collection(db, "projects").withConverter(converter),
    orderBy("createdAt", "desc")
  );
}

export function projectRef(projectId: string) {
  return doc(db, "projects", projectId).withConverter(converter);
}

export async function createProject(input: { name: string; description: string }) {
  return addDoc(collection(db, "projects").withConverter(converter), {
    id: "",
    name: input.name,
    description: input.description,
    status: "active" as ProjectStatus,
    objectives: [],
    progress: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as unknown as Project);
}

export async function updateProject(
  projectId: string,
  updates: Partial<Pick<Project, "name" | "description" | "status" | "progress">>
) {
  return updateDoc(doc(db, "projects", projectId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Deleting a project must also delete its tasks subcollection —
 * Firestore never cascade-deletes subcollections on its own, and a
 * leftover task with a projectId pointing at a deleted project becomes
 * a dangling reference (breaks Mind View's graph edges, pollutes
 * listOpenTasks, etc).
 */
export async function deleteProject(projectId: string) {
  const tasksSnap = await getDocs(collection(db, "projects", projectId, "tasks"));
  const batch = writeBatch(db);
  for (const taskDoc of tasksSnap.docs) {
    batch.delete(taskDoc.ref);
  }
  batch.delete(doc(db, "projects", projectId));
  return batch.commit();
}

export async function listProjectsOnce() {
  const snap = await getDocs(projectsQuery());
  return snap.docs.map((d) => d.data());
}
