import type { PendingActionType } from "@/types";

/**
 * Which assistant actions destroy something.
 *
 * Auto-execute mode is permission to get on with the work, not permission to
 * throw it away. Creating a duplicate task is a nuisance; deleting the wrong
 * project takes its tasks, research, decisions and uploaded documents with it,
 * and there is no undo. So these always queue for approval whatever the mode
 * says — enforced on the server in `orchestrator.ts` and again on the client
 * in the chat page, because both can run tools.
 *
 * Lives in its own module so those two enforcement points cannot drift apart,
 * and so the exhaustiveness check below applies to both.
 */

/** Every action type whose name says it deletes. */
type DeleteAction = Extract<PendingActionType, `delete${string}`>;

const DESTRUCTIVE_LIST = [
  "deleteTask",
  "deleteProject",
  "deletePerson",
  "deleteReminder",
  "deleteKnowledge",
] as const satisfies readonly DeleteAction[];

/**
 * Adding a `delete*` action type without listing it above is a compile error.
 *
 * Without this, a new delete tool would quietly inherit auto-execute — the
 * failure would be silent, irreversible, and only visible after data was gone.
 */
type Unlisted = Exclude<DeleteAction, (typeof DESTRUCTIVE_LIST)[number]>;
const _everyDeleteIsGated: Unlisted extends never ? true : ["not gated:", Unlisted] = true;
void _everyDeleteIsGated;

export const DESTRUCTIVE_ACTIONS: ReadonlySet<PendingActionType> = new Set<PendingActionType>(
  DESTRUCTIVE_LIST
);

export function isDestructive(action: PendingActionType): boolean {
  return DESTRUCTIVE_ACTIONS.has(action);
}
