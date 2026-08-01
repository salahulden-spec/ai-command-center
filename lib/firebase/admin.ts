import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";

/**
 * Server-only Firestore access via a service account, for code that has no
 * signed-in browser session to rely on — currently just the WhatsApp webhook,
 * which runs unattended with nobody's app open. Everywhere else in this app
 * writes through the client SDK under a real user session; reach for this
 * only when there genuinely is no such session.
 */
function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is not set — required for any server-side (no browser session) Firestore access."
    );
  }
  return initializeApp({ credential: cert(JSON.parse(raw)) });
}

export function adminDb() {
  return getFirestore(adminApp());
}

export { Timestamp as AdminTimestamp, FieldValue as AdminFieldValue };
