import { atom } from "jotai";

export interface Builder {
  id: string;
  ipAddress: string;
  createdAt?: string;
  expiresAt: string;
  status: string;
  assignedTask: string;
  /** All assigned tasks for display with line breaks in Status column */
  assignedTasks?: string[];
  architecture?: string;
  lastUptime?: string;
  lastUptimeUpdatedAt?: string;
  executionStatus?: string;
}

export const buildersAtom = atom<Builder[]>([]);
