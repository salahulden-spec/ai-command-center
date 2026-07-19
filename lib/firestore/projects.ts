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
import { ref, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase/client";
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
 * Deleting a project must also delete its subcollections — Firestore
 * never cascade-deletes these on its own, and leftovers become dangling
 * references (breaks Mind View's graph edges, pollutes listOpenTasks,
 * leaks Storage blobs for documents, etc).
 */
export async function deleteProject(projectId: string) {
  const [tasksSnap, researchSnap, decisionsSnap, documentsSnap] = await Promise.all([
    getDocs(collection(db, "projects", projectId, "tasks")),
    getDocs(collection(db, "projects", projectId, "research")),
    getDocs(collection(db, "projects", projectId, "decisions")),
    getDocs(collection(db, "projects", projectId, "documents")),
  ]);

  await Promise.all(
    documentsSnap.docs.map(async (docSnap) => {
      const storagePath = docSnap.data().storagePath as string;
      if (!storagePath) return;
      try {
        await deleteObject(ref(storage, storagePath));
      } catch {
        // storage object may already be gone — best effort
      }
    })
  );

  const batch = writeBatch(db);
  for (const snap of [tasksSnap, researchSnap, decisionsSnap, documentsSnap]) {
    for (const docSnap of snap.docs) {
      batch.delete(docSnap.ref);
    }
  }
  batch.delete(doc(db, "projects", projectId));
  return batch.commit();
}

export async function listProjectsOnce() {
  const snap = await getDocs(projectsQuery());
  return snap.docs.map((d) => d.data());
}
