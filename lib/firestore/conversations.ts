import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  serverTimestamp,
  orderBy,
  limit,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { makeConverter } from "./converter";
import type { Conversation } from "@/types";
import type { UIMessage } from "ai";

const converter = makeConverter<Conversation>();

export function conversationsQuery() {
  return query(
    collection(db, "conversations").withConverter(converter),
    orderBy("updatedAt", "desc"),
    limit(20)
  );
}

function extractText(message: UIMessage): string {
  const textPart = message.parts.find((p) => p.type === "text");
  return textPart && "text" in textPart ? textPart.text : "";
}

/** Strip undefined values so Firestore doesn't reject the write. */
function sanitize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export async function createConversation(messages: UIMessage[]) {
  const firstUserText = messages.find((m) => m.role === "user");
  const title = firstUserText ? extractText(firstUserText).slice(0, 60) : "New conversation";
  const last = messages[messages.length - 1];

  const ref = await addDoc(collection(db, "conversations").withConverter(converter), {
    id: "",
    title: title || "New conversation",
    lastMessagePreview: last ? extractText(last).slice(0, 100) : "",
    messages: sanitize(messages),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as unknown as Conversation);
  return ref.id;
}

export async function updateConversationMessages(id: string, messages: UIMessage[]) {
  const last = messages[messages.length - 1];
  return updateDoc(doc(db, "conversations", id), {
    lastMessagePreview: last ? extractText(last).slice(0, 100) : "",
    messages: sanitize(messages),
    updatedAt: serverTimestamp(),
  });
}

export async function getConversationOnce(id: string): Promise<UIMessage[] | null> {
  const snap = await getDoc(doc(db, "conversations", id).withConverter(converter));
  if (!snap.exists()) return null;
  return snap.data().messages as UIMessage[];
}

export async function deleteConversation(id: string) {
  return deleteDoc(doc(db, "conversations", id));
}
