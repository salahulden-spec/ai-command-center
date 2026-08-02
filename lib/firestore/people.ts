import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  getDoc,
  getDocs,
  updateDoc,
  serverTimestamp,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { Person } from "@/types";

const converter = makeConverter<Person>();

export function peopleQuery() {
  return query(
    collection(db, "people").withConverter(converter),
    orderBy("createdAt", "desc")
  );
}

export async function createPerson(input: { name: string; company: string; notes: string }) {
  return addDoc(collection(db, "people").withConverter(converter), {
    id: "",
    name: input.name,
    company: input.company,
    notes: input.notes,
    createdAt: serverTimestamp(),
  } as unknown as Person);
}

/**
 * Enriches an existing contact. Notes are appended rather than replaced — the
 * assistant calls this to add what it just learned, and overwriting would
 * throw away everything known about someone on each new mention.
 *
 * `name` exists so a contact first recorded by role ("my boss") can be renamed
 * once their actual name comes up, instead of becoming a second contact.
 */
export async function appendPersonNote(
  personId: string,
  updates: { appendNote?: string | null; company?: string | null; name?: string | null }
) {
  const ref = doc(db, "people", personId).withConverter(converter);
  const patch: Record<string, unknown> = {};
  if (updates.name) patch.name = updates.name;
  if (updates.company) patch.company = updates.company;
  if (updates.appendNote) {
    const existing = (await getDoc(ref)).data()?.notes ?? "";
    patch.notes = existing ? `${existing}\n${updates.appendNote}` : updates.appendNote;
  }
  if (!Object.keys(patch).length) return;
  return updateDoc(doc(db, "people", personId), patch);
}

export async function deletePerson(personId: string) {
  return deleteDoc(doc(db, "people", personId));
}

export async function listPeopleOnce() {
  const snap = await getDocs(peopleQuery());
  return snap.docs.map((d) => d.data());
}
