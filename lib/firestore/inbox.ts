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
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { InboxItem, InboxItemType } from "@/types";

const converter = makeConverter<InboxItem>();

export function inboxQuery() {
  return query(
    collection(db, "inbox").withConverter(converter),
    orderBy("createdAt", "desc")
  );
}

export async function createInboxItem(content: string, type: InboxItemType = "note") {
  return addDoc(collection(db, "inbox").withConverter(converter), {
    id: "",
    type,
    content,
    status: "unprocessed",
    createdAt: serverTimestamp(),
  } as unknown as InboxItem);
}

export async function markInboxItemOrganized(itemId: string) {
  return updateDoc(doc(db, "inbox", itemId), { status: "organized" });
}

export async function deleteInboxItem(itemId: string) {
  return deleteDoc(doc(db, "inbox", itemId));
}
