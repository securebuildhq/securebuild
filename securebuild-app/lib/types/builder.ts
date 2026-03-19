export interface Builder {
  id: string;
  machineId: string;
  ipAddress: string;
  port: number;
  status: string;
  assignedTask?: string;
  /** All assigned tasks (e.g. "Build Package: id") for display with line breaks */
  assignedTasks?: string[];
  createdAt?: string;
  expiresAt: string;
  architecture?: string;
  lastUptime?: string;
  lastUptimeUpdatedAt?: string;
  executionStatus?: string;
}
