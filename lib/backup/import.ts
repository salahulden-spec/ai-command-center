import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { deserializeValue } from "./serialize";
import type { BackupFile } from "./export";
export type { BackupFile } from "./export";

const PROJECT_SUBCOLLECTIONS = ["tasks", "research", "decisions", "documents"] as const;

export function parseBackupFile(raw: string): BackupFile {
  const data = JSON.parse(raw);
  if (typeof data !== "object" || data === null || typeof data.version !== "number" || typeof data.collections !== "object") {
    throw new Error("This doesn't look like an AI Command Center backup file.");
  }
  return data as BackupFile;
}

/** Counts what a backup would add, without writing anything — for the confirmation step. */
export function summarizeBackup(file: BackupFile): { label: string; count: number }[] {
  const projects = file.collections.projects ?? [];
  const projectSubCount = projects.reduce(
    (sum, p) =>
      sum + PROJECT_SUBCOLLECTIONS.reduce((s, key) => s + ((p[key] as unknown[] | undefined)?.length ?? 0), 0),
    0
  );
  return [
    { label: "Projects (+ their tasks/research/decisions/documents)", count: projects.length + projectSubCount },
    ...Object.entries(file.collections)
      .filter(([name]) => name !== "projects")
      .map(([name, docs]) => ({ label: name, count: docs.length })),
  ].filter((entry) => entry.count > 0);
}

async function restoreCollection(path: string, docs: Record<string, unknown>[]): Promise<number> {
  for (const raw of docs) {
    const { id: _id, ...fields } = raw;
    await addDoc(collection(db, path), deserializeValue(fields) as Record<string, unknown>);
  }
  return docs.length;
}

/**
 * Additive only: every restored document gets a brand-new Firestore ID, so
 * this can never overwrite or delete existing data — running it twice just
 * duplicates entries. Project subcollections are re-attached under the
 * project's freshly-generated ID since the original ID isn't reused.
 */
export async function importBackup(file: BackupFile): Promise<number> {
  let restored = 0;

  for (const project of file.collections.projects ?? []) {
    const { id: _id, ...rest } = project;
    const subcollections = Object.fromEntries(
      PROJECT_SUBCOLLECTIONS.map((key) => [key, rest[key]])
    );
    for (const key of PROJECT_SUBCOLLECTIONS) delete rest[key];

    const ref = await addDoc(collection(db, "projects"), deserializeValue(rest) as Record<string, unknown>);
    restored += 1;
    for (const name of PROJECT_SUBCOLLECTIONS) {
      restored += await restoreCollection(
        `projects/${ref.id}/${name}`,
        (subcollections[name] as Record<string, unknown>[] | undefined) ?? []
      );
    }
  }

  for (const [name, docs] of Object.entries(file.collections)) {
    if (name === "projects") continue;
    restored += await restoreCollection(name, docs);
  }

  return restored;
}
