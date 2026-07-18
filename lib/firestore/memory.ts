import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  getDocs,
  serverTimestamp,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { Memory, MemoryType } from "@/types";

const converter = makeConverter<Memory>();

export function memoryQuery() {
  return query(
    collection(db, "memory").withConverter(converter),
    orderBy("createdAt", "desc")
  );
}

export async function createMemory(input: {
  type: MemoryType;
  content: string;
  embedding: number[];
  relatedProjectId?: string | null;
  source?: "manual" | "ai";
}) {
  return addDoc(collection(db, "memory").withConverter(converter), {
    id: "",
    type: input.type,
    content: input.content,
    embedding: input.embedding,
    relatedProjectId: input.relatedProjectId ?? null,
    source: input.source ?? "ai",
    createdAt: serverTimestamp(),
  } as unknown as Memory);
}

export async function deleteMemory(memoryId: string) {
  return deleteDoc(doc(db, "memory", memoryId));
}

export async function listMemoriesOnce() {
  const snap = await getDocs(memoryQuery());
  return snap.docs.map((d) => d.data());
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
