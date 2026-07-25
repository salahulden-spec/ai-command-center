import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { serializeValue } from "./serialize";

export const BACKUP_VERSION = 1;

const FLAT_COLLECTIONS = [
  "tasks",
  "reminders",
  "people",
  "memory",
  "conversations",
  "inbox",
  "workflows",
  "briefings",
] as const;

const PROJECT_SUBCOLLECTIONS = ["tasks", "research", "decisions", "documents"] as const;

async function dumpCollection(path: string): Promise<Record<string, unknown>[]> {
  const snap = await getDocs(collection(db, path));
  return snap.docs.map((d) => ({
    id: d.id,
    ...(serializeValue(d.data()) as Record<string, unknown>),
  }));
}

export interface BackupFile {
  version: number;
  exportedAt: string;
  collections: Record<string, Record<string, unknown>[]>;
}

export async function exportAllData(): Promise<BackupFile> {
  const flatEntries = await Promise.all(
    FLAT_COLLECTIONS.map(async (name) => [name, await dumpCollection(name)] as const)
  );

  const rawProjects = await dumpCollection("projects");
  const projects = await Promise.all(
    rawProjects.map(async (project) => {
      const subEntries = await Promise.all(
        PROJECT_SUBCOLLECTIONS.map(
          async (name) => [name, await dumpCollection(`projects/${project.id}/${name}`)] as const
        )
      );
      return { ...project, ...Object.fromEntries(subEntries) };
    })
  );

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    collections: { projects, ...Object.fromEntries(flatEntries) },
  };
}

export function downloadBackup(data: BackupFile) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ai-command-center-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
