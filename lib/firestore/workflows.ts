import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { Workflow, WorkflowStep, WorkflowTrigger } from "@/types";

const converter = makeConverter<Workflow>();

export function workflowsQuery() {
  return query(collection(db, "workflows").withConverter(converter), orderBy("createdAt", "desc"));
}

/**
 * New workflows are always created disabled — they run without further
 * per-action confirmation once enabled, so unlike one-off chat actions,
 * standing automations get an explicit separate review step (the
 * Automations page toggle) instead of going through aiMode/pendingActions.
 */
export async function createWorkflow(input: {
  name: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
}) {
  return addDoc(collection(db, "workflows").withConverter(converter), {
    id: "",
    name: input.name,
    trigger: input.trigger,
    steps: input.steps,
    enabled: false,
    createdAt: serverTimestamp(),
  } as unknown as Workflow);
}

export async function setWorkflowEnabled(workflowId: string, enabled: boolean) {
  return updateDoc(doc(db, "workflows", workflowId), { enabled });
}

export async function deleteWorkflow(workflowId: string) {
  return deleteDoc(doc(db, "workflows", workflowId));
}
