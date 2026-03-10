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
        mp.assigned_task_type,
        mp.assigned_task_id,
        mp.architecture,
        mp.last_uptime,
        mp.last_uptime_updated_at,
        mp.is_on_demand,
        e.status as execution_status
      FROM machine_pool mp
      LEFT JOIN execution e ON (
        (mp.assigned_task_type = 'build_package' AND e.id = mp.assigned_task_id)
      )
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
      builders.push({
        id: row.id,
        machineId: row.machine_id,
        ipAddress: row.ip_address,
        port: row.port,
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        assignedTask: row.assigned_task_type ? `${row.assigned_task_type}/${row.assigned_task_id}` : undefined,
        architecture: row.architecture,
        lastUptime: row.last_uptime,
        lastUptimeUpdatedAt: row.last_uptime_updated_at,
        executionStatus: row.execution_status,
      });
    }

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

export async function getBuilder(builderId: string): Promise<Builder | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id, machine_id, created_at, expires_at, private_key, username, status, ip_address, port, architecture from machine_pool where id = $1`;
    const result = await db.query(query, [builderId]);
    if (result.rows.length === 0) {
      return null;
    }

    const builder: Builder = {
      id: result.rows[0].id,
      machineId: result.rows[0].machine_id,
      ipAddress: result.rows[0].ip_address,
      port: result.rows[0].port,
      status: result.rows[0].status,
      assignedTask: result.rows[0].assigned_task,
      expiresAt: result.rows[0].expires_at,
      architecture: result.rows[0].architecture,
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

