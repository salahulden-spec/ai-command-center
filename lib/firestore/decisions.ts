import { collection, doc, addDoc, deleteDoc, serverTimestamp, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { Decision, DecisionOption } from "@/types";

const converter = makeConverter<Decision>();

export function decisionsQuery(projectId: string) {
  return query(
    collection(db, "projects", projectId, "decisions").withConverter(converter),
    orderBy("decidedAt", "desc")
  );
}

export async function createDecision(
  projectId: string,
  input: {
    question: string;
    options: DecisionOption[];
    recommended: string;
    reasoning: string;
    confidence: number;
  }
) {
  return addDoc(collection(db, "projects", projectId, "decisions").withConverter(converter), {
    id: "",
    question: input.question,
    options: input.options,
    recommended: input.recommended,
    reasoning: input.reasoning,
    confidence: input.confidence,
    decidedAt: serverTimestamp(),
  } as unknown as Decision);
}

export async function deleteDecision(projectId: string, decisionId: string) {
  return deleteDoc(doc(db, "projects", projectId, "decisions", decisionId));
}
