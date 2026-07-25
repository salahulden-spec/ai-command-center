import { doc, setDoc, deleteDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { GoogleIntegration } from "@/types";

function googleIntegrationRef(uid: string) {
  return doc(db, "users", uid, "integrations", "google");
}

export async function saveGoogleIntegration(uid: string, refreshToken: string, scope: string) {
  return setDoc(googleIntegrationRef(uid), {
    refreshToken,
    scope,
    connectedAt: serverTimestamp(),
  });
}

export async function disconnectGoogle(uid: string) {
  return deleteDoc(googleIntegrationRef(uid));
}

export async function getGoogleIntegrationOnce(uid: string): Promise<GoogleIntegration | null> {
  const snap = await getDoc(googleIntegrationRef(uid));
  return snap.exists() ? (snap.data() as GoogleIntegration) : null;
}
