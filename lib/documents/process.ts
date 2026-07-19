import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import {
  createDocumentRecord,
  markDocumentFailed,
  updateDocumentResult,
  uploadDocumentFile,
} from "@/lib/firestore/documents";
import { extractTextIfNeeded } from "./extract-client";
import { analyzeFileUrl, analyzeText } from "./analyze-client";
import type { DocumentEntities } from "@/types";

/** Uploads a file to a project's Documents section, then extracts/analyzes it in the background. */
export async function processDocumentUpload(projectId: string, file: File): Promise<void> {
  const docRef = await createDocumentRecord(projectId, {
    fileName: file.name,
    fileType: file.type || "application/octet-stream",
    storagePath: "",
  });

  try {
    const storagePath = await uploadDocumentFile(projectId, docRef.id, file);
    const result = await runExtraction(file, storagePath);
    await updateDocumentResult(projectId, docRef.id, result);
  } catch {
    await markDocumentFailed(projectId, docRef.id);
  }
}

/** Analyzes a file without filing it under a project — used for one-off chat attachments. */
export async function analyzeAdHocFile(
  file: File
): Promise<{ summary: string; entities: DocumentEntities }> {
  const name = file.name.toLowerCase();
  const text = await extractTextIfNeeded(file);
  if (text !== null) {
    return analyzeText(text);
  }
  if (name.endsWith(".pdf") || file.type.startsWith("image/")) {
    // Ad-hoc chat attachments upload to a scratch path so the server can fetch bytes by URL.
    const path = `documents/_chat-attachments/${crypto.randomUUID()}/${file.name}`;
    const { uploadBytes } = await import("firebase/storage");
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    return analyzeFileUrl(url, file.type || "application/octet-stream");
  }
  throw new Error("Unsupported file type.");
}

async function runExtraction(
  file: File,
  storagePath: string
): Promise<{ summary: string; entities: DocumentEntities }> {
  const text = await extractTextIfNeeded(file);
  if (text !== null) {
    return analyzeText(text);
  }
  const url = await getDownloadURL(ref(storage, storagePath));
  return analyzeFileUrl(url, file.type || "application/octet-stream");
}
