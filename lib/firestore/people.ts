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

export async function deletePerson(personId: string) {
  return deleteDoc(doc(db, "people", personId));
}

export async function listPeopleOnce() {
  const snap = await getDocs(peopleQuery());
  return snap.docs.map((d) => d.data());
}
