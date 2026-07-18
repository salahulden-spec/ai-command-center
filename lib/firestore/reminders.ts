import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  orderBy,
  where,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { Reminder } from "@/types";

const converter = makeConverter<Reminder>();

export function remindersQuery() {
  return query(
    collection(db, "reminders").withConverter(converter),
    orderBy("dueAt", "asc")
  );
}

export async function createReminder(input: { text: string; dueAt: Date }) {
  return addDoc(collection(db, "reminders").withConverter(converter), {
    id: "",
    text: input.text,
    dueAt: Timestamp.fromDate(input.dueAt),
    status: "pending",
    relatedProjectId: null,
    createdAt: serverTimestamp(),
  } as unknown as Reminder);
}

export async function markReminderDone(reminderId: string) {
  return updateDoc(doc(db, "reminders", reminderId), { status: "done" });
}

export async function deleteReminder(reminderId: string) {
  return deleteDoc(doc(db, "reminders", reminderId));
}

/** All pending reminders, for the AI to reference (e.g. to mark one done by description). */
export async function listPendingRemindersOnce() {
  const snap = await getDocs(
    query(collection(db, "reminders").withConverter(converter), where("status", "==", "pending"))
  );
  return snap.docs.map((d) => d.data());
}
