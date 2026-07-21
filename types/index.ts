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
  updatedAt: Timestamp | null;
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

export type MemoryType = "fact" | "preference" | "person" | "company" | "decision";

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  embedding: number[];
  relatedProjectId: string | null;
  source: "manual" | "ai";
  createdAt: Timestamp;
}

export interface Conversation {
  id: string;
  title: string;
  lastMessagePreview: string;
  messages: unknown[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DecisionOption {
  label: string;
  pros: string;
  cons: string;
  cost: string;
  time: string;
  risk: string;
  roi: string;
}

export interface Decision {
  id: string;
  question: string;
  options: DecisionOption[];
  recommended: string;
  reasoning: string;
  confidence: number;
  decidedAt: Timestamp;
}

export interface ResearchEntry {
  id: string;
  title: string;
  content: string;
  links: string[];
  tags: string[];
  createdAt: Timestamp;
}

export interface DocumentEntities {
  dates: string[];
  people: string[];
  companies: string[];
  tasks: string[];
}

export type DocumentStatus = "processing" | "done" | "failed";

export interface ProjectDocument {
  id: string;
  fileName: string;
  fileType: string;
  storagePath: string;
  status: DocumentStatus;
  extractedSummary: string;
  extractedEntities: DocumentEntities;
  createdAt: Timestamp;
}

export type WorkflowStep =
  | { type: "createTask"; title: string; projectId: string | null }
  | { type: "createReminder"; text: string; delayMinutes: number };

export interface WorkflowTrigger {
  collection: "tasks";
  event: "statusChanged";
  toStatus: string;
}

export interface Workflow {
  id: string;
  name: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  enabled: boolean;
  createdAt: Timestamp;
}

export type PendingActionType =
  | "createProject"
  | "createTask"
  | "createReminder"
  | "completeTask"
  | "completeReminder"
  | "saveMemory"
  | "saveDecision"
  | "saveResearch"
  | "saveDocument";
export type PendingActionStatus = "pending" | "approved" | "rejected";

export interface PendingAction {
  id: string;
  actionType: PendingActionType;
  summary: string;
  payload: Record<string, unknown>;
  status: PendingActionStatus;
  createdAt: Timestamp;
}
