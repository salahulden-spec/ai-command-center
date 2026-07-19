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
import { ref, uploadBytes, deleteObject } from "firebase/storage";
import { db, storage } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { DocumentEntities, ProjectDocument } from "@/types";

const converter = makeConverter<ProjectDocument>();

export function documentsQuery(projectId: string) {
  return query(
    collection(db, "projects", projectId, "documents").withConverter(converter),
    orderBy("createdAt", "desc")
  );
}

export async function uploadDocumentFile(projectId: string, docId: string, file: File) {
  const storagePath = `documents/${projectId}/${docId}/${file.name}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file);
  return storagePath;
}

export async function createDocumentRecord(
  projectId: string,
  input: { fileName: string; fileType: string; storagePath: string }
) {
  return addDoc(collection(db, "projects", projectId, "documents").withConverter(converter), {
    id: "",
    fileName: input.fileName,
    fileType: input.fileType,
    storagePath: input.storagePath,
    status: "processing",
    extractedSummary: "",
    extractedEntities: { dates: [], people: [], companies: [], tasks: [] },
    createdAt: serverTimestamp(),
  } as unknown as ProjectDocument);
}

export async function updateDocumentResult(
  projectId: string,
  docId: string,
  result: { summary: string; entities: DocumentEntities }
) {
  return updateDoc(doc(db, "projects", projectId, "documents", docId), {
    status: "done",
    extractedSummary: result.summary,
    extractedEntities: result.entities,
  });
}

/** Files an already-analyzed attachment (from chat) straight into a project's Documents section. */
export async function createFiledDocument(
  projectId: string,
  input: { fileName: string; summary: string; entities: DocumentEntities }
) {
  return addDoc(collection(db, "projects", projectId, "documents").withConverter(converter), {
    id: "",
    fileName: input.fileName,
    fileType: "",
    storagePath: "",
    status: "done",
    extractedSummary: input.summary,
    extractedEntities: input.entities,
    createdAt: serverTimestamp(),
  } as unknown as ProjectDocument);
}

export async function markDocumentFailed(projectId: string, docId: string) {
  return updateDoc(doc(db, "projects", projectId, "documents", docId), {
    status: "failed",
  });
}

export async function deleteDocumentRecord(
  projectId: string,
  docId: string,
  storagePath: string
) {
  await deleteDoc(doc(db, "projects", projectId, "documents", docId));
  try {
    await deleteObject(ref(storage, storagePath));
  } catch {
    // storage object may already be gone — the Firestore record is the source of truth
  }
}
