import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
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

export async function deleteProject(projectId: string) {
  return deleteDoc(doc(db, "projects", projectId));
}
