export interface Builder {
  id: string;
  machineId: string;
  ipAddress: string;
  port: number;
  status: string;
  assignedTask?: string;
  createdAt?: string;
  expiresAt: string;
  architecture?: string;
  lastUptime?: string;
  lastUptimeUpdatedAt?: string;
  executionStatus?: string;
}
