import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  orderBy,
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
