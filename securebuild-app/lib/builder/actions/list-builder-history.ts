"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";

export interface BuilderHistory {
  id: string;
  machineId: string;
  ipAddress: string;
  port: number;
  status: string;
  assignedTask?: string;
  createdAt: string;
  expiresAt: string | null;
  deletedAt: string;
  terminationReason: string;
  architecture?: string;
}

export async function listBuilderHistoryAction(): Promise<BuilderHistory[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    // Get machines terminated in the past 6 hours
    const query = `
      SELECT
        id,
        machine_id,
        created_at,
        expires_at,
        status,
        ip_address,
        port,
        assigned_task_type,
        assigned_task_id,
        architecture,
        deleted_at,
        termination_reason
      FROM machine_pool_history
      WHERE deleted_at >= NOW() - INTERVAL '6 hours'
      ORDER BY deleted_at DESC
    `;

    const result = await db.query(query);

    const builders: BuilderHistory[] = [];
    for (const row of result.rows) {
      const assignedTask = row.assigned_task_type && row.assigned_task_id
        ? `${row.assigned_task_type}/${row.assigned_task_id}`
        : undefined;

      builders.push({
        id: row.id,
        machineId: row.machine_id,
        ipAddress: row.ip_address || "",
        port: row.port || 0,
        status: row.status,
        assignedTask: assignedTask,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        deletedAt: row.deleted_at,
        terminationReason: row.termination_reason,
        architecture: row.architecture,
      });
    }

    // Format assigned tasks for better display
    for (const builder of builders) {
      if (builder.assignedTask) {
        const [taskType, taskId] = builder.assignedTask.split("/");

        switch (taskType) {
          case "build_package":
            builder.assignedTask = `Build Package: ${taskId}`;
            break;
          case "build_image":
            builder.assignedTask = `Build Image: ${taskId}`;
            break;
          case "publish_package":
            builder.assignedTask = `Publish Package: ${taskId}`;
            break;
          default:
            builder.assignedTask = `Unknown Task: ${taskType}`;
            break;
        }
      }
    }

    return builders;
  } catch (err) {
    console.error(err);
    throw err;
  }
}
