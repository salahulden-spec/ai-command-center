import { doc, setDoc, type DocumentReference } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { AiMode, UserSettings } from "@/types";

export function userSettingsRef(uid: string): DocumentReference<UserSettings> {
  return doc(db, "users", uid) as DocumentReference<UserSettings>;
}

export async function setAiMode(uid: string, aiMode: AiMode) {
  return setDoc(doc(db, "users", uid), { aiMode }, { merge: true });
}
