import { collection, doc, addDoc, deleteDoc, serverTimestamp, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { ResearchEntry } from "@/types";

const converter = makeConverter<ResearchEntry>();

export function researchQuery(projectId: string) {
  return query(
    collection(db, "projects", projectId, "research").withConverter(converter),
    orderBy("createdAt", "desc")
  );
}

export async function createResearchEntry(
  projectId: string,
  input: { title: string; content: string; links?: string[]; tags?: string[] }
) {
  return addDoc(collection(db, "projects", projectId, "research").withConverter(converter), {
    id: "",
    title: input.title,
    content: input.content,
    links: input.links ?? [],
    tags: input.tags ?? [],
    createdAt: serverTimestamp(),
  } as unknown as ResearchEntry);
}

export async function deleteResearchEntry(projectId: string, researchId: string) {
  return deleteDoc(doc(db, "projects", projectId, "research", researchId));
}
