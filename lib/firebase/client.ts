import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);

/**
 * IndexedDB-backed cache, browser only.
 *
 * Without it every page visit re-fetches from the network before rendering a
 * single row — noticeable on a phone, and useless with no signal. With it,
 * listeners resolve from disk instantly and then reconcile against the server,
 * so navigating back to a screen you've already seen is immediate.
 *
 * `initializeFirestore` must run before anything calls `getFirestore`, and
 * throws if called twice, so this is guarded on both the environment and the
 * already-initialised case (Fast Refresh re-runs this module).
 */
function createDb() {
  if (typeof window === "undefined") return getFirestore(firebaseApp);
  try {
    return initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Already initialised (Fast Refresh), or IndexedDB is unavailable —
    // private browsing, storage disabled. Memory cache still works fine.
    return getFirestore(firebaseApp);
  }
}

export const db = createDb();
export const storage = getStorage(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
