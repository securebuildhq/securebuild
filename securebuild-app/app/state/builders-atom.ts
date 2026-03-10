import { atom } from "jotai";

export interface Builder {
  id: string;
  ipAddress: string;
  createdAt?: string;
  expiresAt: string;
  status: string;
  assignedTask: string;
  architecture?: string;
  lastUptime?: string;
  lastUptimeUpdatedAt?: string;
  executionStatus?: string;
}

export const buildersAtom = atom<Builder[]>([]);
