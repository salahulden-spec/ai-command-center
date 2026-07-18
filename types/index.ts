import type { Timestamp } from "firebase/firestore";

export type ProjectStatus = "active" | "blocked" | "paused" | "done" | "archived";

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  objectives: string[];
  progress: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type TaskStatus = "todo" | "doing" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Timestamp | null;
  projectId: string | null;
  source: "manual" | "ai";
  createdAt: Timestamp;
}

export type InboxItemType = "note" | "link";
export type InboxItemStatus = "unprocessed" | "organized";

export interface InboxItem {
  id: string;
  type: InboxItemType;
  content: string;
  status: InboxItemStatus;
  createdAt: Timestamp;
}

export type ReminderStatus = "pending" | "done";

export interface Reminder {
  id: string;
  text: string;
  dueAt: Timestamp;
  status: ReminderStatus;
  relatedProjectId: string | null;
  createdAt: Timestamp;
}

export interface Person {
  id: string;
  name: string;
  company: string;
  notes: string;
  createdAt: Timestamp;
}

export type AiMode = "ask" | "execute";

export interface UserSettings {
  aiMode: AiMode;
}

export type PendingActionType =
  | "createProject"
  | "createTask"
  | "createReminder"
  | "completeTask"
  | "completeReminder";
export type PendingActionStatus = "pending" | "approved" | "rejected";

export interface PendingAction {
  id: string;
  actionType: PendingActionType;
  summary: string;
  payload: Record<string, unknown>;
  status: PendingActionStatus;
  createdAt: Timestamp;
}
