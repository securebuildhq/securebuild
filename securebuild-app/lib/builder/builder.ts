import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { Builder } from "../types/builder";
import * as srs from "secure-random-string";
import { enqueueWork } from "../utils/queue";

export async function deleteBuilder(id: string) {
  try {
    // Get the CMX API parameters
    const replicatedAPIOrigin = await getParam("REPLICATED_API_ORIGIN");
    const replicatedAPIToken = await getParam("REPLICATED_API_TOKEN");

    // Make the CMX API call to delete the VM
    const response = await fetch(`${replicatedAPIOrigin}/v3/vm/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': replicatedAPIToken,
        'Accept': 'application/json'
      }
    });

    // Handle the response similar to the Go code
    if (response.status !== 200 && response.status !== 404) {
      const responseText = await response.text();
      console.error(`Failed to delete VM via CMX API: ${response.status}`);
      console.error(`Response body: ${responseText}`);
      throw new Error(`Failed to delete VM via CMX API: ${response.status} - ${responseText}`);
    }

    // Only delete from database if CMX API call succeeded
    const db = getDB(await getParam("DB_URI"));
    const query = `delete from machine_pool where id = $1`;
    await db.query(query, [id]);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

function formatAssignmentLabel(taskType: string, taskId: string): string {
  switch (taskType) {
    case "build_package":
      return `Build Package: ${taskId}`;
    case "build_image":
      return `Build Image: ${taskId}`;
    case "publish_package":
      return `Publish Package: ${taskId}`;
    default:
      return `Unknown Task: ${taskType}`;
  }
}

export async function listBuilders(isOnDemand?: boolean): Promise<Builder[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    let query = `
      SELECT
        mp.id,
        mp.machine_id,
        mp.created_at,
        mp.expires_at,
        mp.private_key,
        mp.username,
        mp.status,
        mp.ip_address,
        mp.port,
        mp.architecture,
        mp.last_uptime,
        mp.last_uptime_updated_at,
        mp.is_on_demand,
        COALESCE(ma_agg.assignments, '[]'::json) AS assignments,
        first_exec.status AS execution_status
      FROM machine_pool mp
      LEFT JOIN (
        SELECT machine_id,
          json_agg(
            json_build_object('assigned_task_type', assigned_task_type, 'assigned_task_id', assigned_task_id)
            ORDER BY assigned_task_type, assigned_task_id
          ) AS assignments
        FROM machine_assignment
        GROUP BY machine_id
      ) ma_agg ON ma_agg.machine_id = mp.id
      LEFT JOIN LATERAL (
        SELECT e.status
        FROM machine_assignment ma
        JOIN execution e ON ma.assigned_task_type = 'build_package' AND e.id = ma.assigned_task_id
        WHERE ma.machine_id = mp.id
        LIMIT 1
      ) first_exec ON true
    `;

    // Add WHERE clause based on isOnDemand parameter
    if (isOnDemand !== undefined) {
      query += ` WHERE mp.is_on_demand = $1`;
    }

    const result = isOnDemand !== undefined
      ? await db.query(query, [isOnDemand])
      : await db.query(query);

    const builders: Builder[] = [];
    for (const row of result.rows) {
      const assignments = Array.isArray(row.assignments) ? row.assignments : (row.assignments ? JSON.parse(row.assignments) : []);
      const assignedTasks: string[] = assignments.map(
        (a: { assigned_task_type: string; assigned_task_id: string }) =>
          formatAssignmentLabel(a.assigned_task_type, a.assigned_task_id)
      );
      builders.push({
        id: row.id,
        machineId: row.machine_id,
        ipAddress: row.ip_address,
        port: row.port,
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        assignedTask: assignedTasks[0],
        assignedTasks: assignedTasks.length ? assignedTasks : undefined,
        architecture: row.architecture,
        lastUptime: row.last_uptime,
        lastUptimeUpdatedAt: row.last_uptime_updated_at,
        executionStatus: row.execution_status,
      });
    }

    return builders;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getBuilder(builderId: string): Promise<Builder | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT
        mp.id, mp.machine_id, mp.created_at, mp.expires_at, mp.private_key, mp.username, mp.status,
        mp.ip_address, mp.port, mp.architecture,
        COALESCE(ma_agg.assignments, '[]'::json) AS assignments
      FROM machine_pool mp
      LEFT JOIN (
        SELECT machine_id,
          json_agg(
            json_build_object('assigned_task_type', assigned_task_type, 'assigned_task_id', assigned_task_id)
            ORDER BY assigned_task_type, assigned_task_id
          ) AS assignments
        FROM machine_assignment
        GROUP BY machine_id
      ) ma_agg ON ma_agg.machine_id = mp.id
      WHERE mp.id = $1`;
    const result = await db.query(query, [builderId]);
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const assignments = Array.isArray(row.assignments) ? row.assignments : (row.assignments ? JSON.parse(row.assignments) : []);
    const assignedTasks: string[] = assignments.map(
      (a: { assigned_task_type: string; assigned_task_id: string }) =>
        formatAssignmentLabel(a.assigned_task_type, a.assigned_task_id)
    );
    const builder: Builder = {
      id: row.id,
      machineId: row.machine_id,
      ipAddress: row.ip_address,
      port: row.port,
      status: row.status,
      assignedTask: assignedTasks[0],
      assignedTasks: assignedTasks.length ? assignedTasks : undefined,
      expiresAt: row.expires_at,
      architecture: row.architecture,
    };

    return builder;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function createSshSession(sessionId: string,builderId: string): Promise<string> {
  try {
    const id = srs.default({ length: 12, alphanumeric: true });
    const db = getDB(await getParam("DB_URI"));
    const query = `insert into ssh_session (id, builder_id, user_session_id, ssh_pid, created_at) values ($1, $2, $3, $4, now() )`;
    await db.query(query, [id, builderId, sessionId, 0]);

    await enqueueWork("start_ssh_session", {
      id,
    });
    return id;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

