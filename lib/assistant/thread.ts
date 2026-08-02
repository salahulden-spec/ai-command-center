import { adminDb, AdminFieldValue } from "@/lib/firebase/admin";
import type { Timestamp } from "firebase-admin/firestore";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * How many turns of history to carry. Twelve is roughly six exchanges — enough
 * that "make that one high priority" still resolves, short enough that the
 * prompt stays small and the model doesn't drag stale intent forward.
 */
const MAX_TURNS = 12;

/**
 * A gap this long starts a fresh conversation. Texting isn't a chat window you
 * deliberately close, so the only signal that a topic is over is silence — and
 * without a reset, tomorrow's "add a task" would be answered in the context of
 * yesterday's unrelated thread.
 */
const IDLE_RESET_MS = 3 * 60 * 60 * 1000;

/** Trims stored content so one long paste can't blow up every later prompt. */
const MAX_CONTENT_CHARS = 2000;

function threadRef(threadKey: string) {
  return adminDb().collection("assistantThreads").doc(threadKey);
}

/** Recent turns for this conversation, oldest first. Empty if idle too long. */
export async function loadThread(threadKey: string): Promise<Turn[]> {
  const snap = await threadRef(threadKey).get();
  if (!snap.exists) return [];

  const data = snap.data();
  const updatedAt = (data?.updatedAt as Timestamp | undefined)?.toMillis() ?? 0;
  if (Date.now() - updatedAt > IDLE_RESET_MS) return [];

  return ((data?.turns as Turn[] | undefined) ?? []).slice(-MAX_TURNS);
}

/** Appends one exchange, keeping only the most recent MAX_TURNS. */
export async function appendTurns(
  threadKey: string,
  previous: Turn[],
  userText: string,
  assistantText: string
): Promise<void> {
  const turns = [
    ...previous,
    { role: "user" as const, content: userText.slice(0, MAX_CONTENT_CHARS) },
    { role: "assistant" as const, content: assistantText.slice(0, MAX_CONTENT_CHARS) },
  ].slice(-MAX_TURNS);

  await threadRef(threadKey).set({ turns, updatedAt: AdminFieldValue.serverTimestamp() });
}

/** Wipes the conversation — backs the "/reset" command. */
export async function clearThread(threadKey: string): Promise<void> {
  await threadRef(threadKey).delete();
}
