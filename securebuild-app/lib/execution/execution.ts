import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { Execution } from "../types/execution";
import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import * as os from 'os';

// Filter interface for execution queries
export interface ExecutionFilters {
  packageId?: string;
  status?: string;
  limit?: number;
}

export async function createDebugArchive(executionID: string): Promise<string> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Get execution details to find the package version
    const executionQuery = `
      SELECT e.package_id, e.version_label
      FROM execution e
      WHERE e.id = $1
    `;
    const executionResult = await db.query(executionQuery, [executionID]);

    if (executionResult.rows.length === 0) {
      throw new Error("Execution not found");
    }

    const { package_id, version_label } = executionResult.rows[0];

    // Get melange.yaml from package_version
    const melangeQuery = `
      SELECT id, melange_yaml
      FROM package_version
      WHERE package_id = $1 AND version = $2
    `;
    const melangeResult = await db.query(melangeQuery, [package_id, version_label]);

    let packageVersionId = null;
    if (melangeResult.rows.length > 0) {
      packageVersionId = melangeResult.rows[0].id;
    }

    // Get additional files from package_version_additional_file
    let additionalFiles = [];
    if (packageVersionId) {
      const additionalFilesQuery = `
        SELECT path, content
        FROM package_version_additional_file
        WHERE package_version_id = $1
      `;
      const additionalFilesResult = await db.query(additionalFilesQuery, [packageVersionId]);
      additionalFiles = additionalFilesResult.rows;
    }

    // Get build filesystem files
    const filesQuery = `
      SELECT filename, content
      FROM build_filesystem
    `;
    const filesResult = await db.query(filesQuery);

    if (filesResult.rows.length === 0 && (!melangeResult.rows.length || !melangeResult.rows[0].melange_yaml) && additionalFiles.length === 0) {
      throw new Error("No build files, melange.yaml, or additional files found for this execution");
    }

    // Create a temporary directory
    const tempDir = path.join(os.tmpdir(), `debug-${executionID}-${Date.now()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Create execution ID subdirectory
    const executionDir = path.join(tempDir, executionID);
    await fs.promises.mkdir(executionDir, { recursive: true });

    try {
      // Write melange.yaml if it exists
      if (melangeResult.rows.length > 0 && melangeResult.rows[0].melange_yaml) {
        const melangeFilePath = path.join(executionDir, 'melange.yaml');
        await fs.promises.writeFile(melangeFilePath, melangeResult.rows[0].melange_yaml);
      }

      // Create build script
      const buildScript = `#!/bin/bash
set -e

echo "Melange Build Reproduction Script"
echo "=================================="
echo "Execution ID: ${executionID}"
echo "Package: ${package_id}"
echo "Version: ${version_label}"
echo ""

# Create necessary directories
mkdir -p packages
mkdir -p /tmp/melange-cache

echo "Starting melange build at $(date)"

# Determine architecture (default to x86_64 if not specified)
ARCH=\${1:-x86_64}
if [ "\$ARCH" = "aarch" ]; then
  ARCH="aarch64"
fi

echo "Building for architecture: \$ARCH"

echo "Using signing key: \$SIGNING_KEY"

# Run melange build
melange build melange.yaml \\
  --arch \$ARCH \\
  --signing-key \$SIGNING_KEY \\
  --keyring-append \$KEYRING_APPEND \\
  --namespace Securebuild \\
  --license 'Apache-2.0' \\
  --cache-dir /tmp/melange-cache \\
  --pipeline-dir ./pipelines/
`;

      const buildScriptPath = path.join(executionDir, 'reproduce.sh');
      await fs.promises.writeFile(buildScriptPath, buildScript, { mode: 0o755 });

      // Write additional files from package_version_additional_file
      for (const additionalFile of additionalFiles) {
        const filePath = path.join(executionDir, additionalFile.path);
        const fileDir = path.dirname(filePath);

        // Create subdirectories if needed
        await fs.promises.mkdir(fileDir, { recursive: true });

        // Write the file content
        await fs.promises.writeFile(filePath, additionalFile.content);
      }

      // Write all build filesystem files
      for (const file of filesResult.rows) {
        const filePath = path.join(executionDir, file.filename);
        const fileDir = path.dirname(filePath);

        // Create subdirectories if needed
        await fs.promises.mkdir(fileDir, { recursive: true });

        // Write the file content
        await fs.promises.writeFile(filePath, file.content);
      }

      // Create tar.gz file
      const tarFilename = path.join(os.tmpdir(), `reproduce-${executionID}.tar.gz`);

      await tar.create({
        gzip: true,
        file: tarFilename,
        cwd: tempDir
      }, [executionID]);

      return tarFilename;

    } finally {
      // Clean up temporary directory
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }

  } catch (err) {
    console.error('Error creating debug archive:', err);
    throw err;
  }
}

// Helper function to get the last N lines from a text string
function getLastNLines(text: string | null, maxLines: number = 5000): string {
  if (!text) return "";

  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return text;
  }

  return lines.slice(-maxLines).join('\n');
}

export async function isExecutionPaused(): Promise<boolean> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `SELECT value FROM execution_control WHERE key = 'pause'`;
    const result = await db.query(query);
    if (result.rows.length === 0) {
      return false;
    }
    return result.rows[0].value === 'true';
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function pauseExecutions(): Promise<boolean> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `INSERT INTO execution_control (key, value) VALUES ('pause', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'`;
    await db.query(query);
    return true;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function resumeExecutions(): Promise<boolean> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `INSERT INTO execution_control (key, value) VALUES ('pause', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false'`;
    await db.query(query);
    return true;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getExecution(id: string): Promise<Execution> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      select
        e.id,
        p.name as package_name,
        e.package_id,
        e.version_label,
        pv.apk_release as apk_release,
        e.status,
        e.created_at,
        e.x86_64_build_stdout,
        e.x86_64_build_stderr,
        e.x86_64_build_exit_code,
        e.x86_64_build_command,
        e.x86_64_build_started_at,
        e.x86_64_build_finished_at,
        e.x86_64_builder_id,
        e.aarch64_build_stdout,
        e.aarch64_build_stderr,
        e.aarch64_build_exit_code,
        e.aarch64_build_command,
        e.aarch64_build_started_at,
        e.aarch64_build_finished_at,
        e.aarch64_builder_id,
        e.x86_64_publish_output,
        e.aarch64_publish_output,
        COALESCE(pv.use_root, false) as use_root,
        COALESCE(pv.bootstrap_enabled, false) as bootstrap_enabled,
        pv.bootstrap_apk_repository,
        pv.bootstrap_keyring_append,
        e.cause,
        e.cause_id
      from execution e
      LEFT JOIN package p ON e.package_id = p.id
      LEFT JOIN package_version pv ON e.package_version_id = pv.id
      where e.id = $1
    `;

    const result = await db.query(query, [id]);
    if (result.rows.length === 0) {
      throw new Error("Execution not found");
    }
    const row = result.rows[0];
    return {
      id: row.id,
      packageId: row.package_id,
      packageName: row.package_name,
      versionLabel: row.version_label,
      apkRelease: row.apk_release,
      status: row.status,
      createdAt: row.created_at,
      x86_64BuildStdout: getLastNLines(row.x86_64_build_stdout),
      x86_64BuildStderr: getLastNLines(row.x86_64_build_stderr),
      x86_64BuildExitCode: row.x86_64_build_exit_code,
      x86_64BuildCommand: row.x86_64_build_command,
      x86_64BuildStartedAt: row.x86_64_build_started_at,
      x86_64BuildFinishedAt: row.x86_64_build_finished_at,
      x86_64BuilderID: row.x86_64_builder_id,
      aarch64BuildStdout: getLastNLines(row.aarch64_build_stdout),
      aarch64BuildStderr: getLastNLines(row.aarch64_build_stderr),
      aarch64BuildExitCode: row.aarch64_build_exit_code,
      aarch64BuildCommand: row.aarch64_build_command,
      aarch64BuildStartedAt: row.aarch64_build_started_at,
      aarch64BuildFinishedAt: row.aarch64_build_finished_at,
      aarch64BuilderID: row.aarch64_builder_id,
      x86_64_publishOutput: getLastNLines(row.x86_64_publish_output),
      aarch64_publishOutput: getLastNLines(row.aarch64_publish_output),
      useRoot: row.use_root,
      bootstrapEnabled: row.bootstrap_enabled,
      bootstrapApkRepository: row.bootstrap_apk_repository,
      bootstrapKeyringAppend: row.bootstrap_keyring_append,
      cause: row.cause,
      causeId: row.cause_id
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function getLastExecutionForPackageVersion(packageVersionId: string): Promise<Execution | null> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      select id from execution where package_version_id = $1 order by created_at desc limit 1
    `;
    const result = await db.query(query, [packageVersionId]);
    if (result.rows.length === 0) {
      return null;
    }
    return getExecution(result.rows[0].id);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function listExecutions(filters: ExecutionFilters = {}, pagination?: { page?: number; limit?: number }): Promise<{ executions: Execution[]; totalCount: number }> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Build WHERE clause based on filters
    const whereConditions: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (filters.packageId) {
      whereConditions.push(`e.package_id = $${paramIndex}`);
      queryParams.push(filters.packageId);
      paramIndex++;
    }

    if (filters.status) {
      whereConditions.push(`e.status = $${paramIndex}`);
      queryParams.push(filters.status);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Join with regular package tables
    const joinClause = `
      LEFT JOIN package p ON e.package_id = p.id
      LEFT JOIN package_version pv ON e.package_version_id = pv.id
    `;
    const packageNameColumn = 'p.name';
    const apkReleaseColumn = 'pv.apk_release';
    const useRootColumn = 'pv.use_root';
    const bootstrapColumns = `
      pv.bootstrap_enabled,
      pv.bootstrap_apk_repository,
      pv.bootstrap_keyring_append
    `;

    // Get total count first
    const countQuery = `
      SELECT COUNT(*) as total
      FROM execution e
      ${joinClause}
      ${whereClause}
    `;
    const countResult = await db.query(countQuery, queryParams);
    const totalCount = parseInt(countResult.rows[0].total);

    // Apply pagination
    const page = pagination?.page || 1;
    const limit = pagination?.limit || filters.limit || 100;
    const offset = (page - 1) * limit;

    const query = `
      select
        e.id,
        ${packageNameColumn} as package_name,
        e.package_id,
        e.version_label,
        ${apkReleaseColumn} as apk_release,
        e.status,
        e.created_at,
        e.x86_64_build_exit_code,
        e.x86_64_build_command,
        e.x86_64_build_started_at,
        e.x86_64_build_finished_at,
        e.x86_64_builder_id,
        e.aarch64_build_exit_code,
        e.aarch64_build_command,
        e.aarch64_build_started_at,
        e.aarch64_build_finished_at,
        e.aarch64_builder_id,
        ${useRootColumn} as use_root,
        ${bootstrapColumns},
        e.cause,
        e.cause_id
      from execution e
      ${joinClause}
      ${whereClause}
      order by e.created_at desc
      limit ${limit}
      offset ${offset}
    `;

    const result = await db.query(query, queryParams);

    const executions = result.rows.map((row) => ({
      id: row.id,
      packageId: row.package_id,
      packageName: row.package_name,
      versionLabel: row.version_label,
      apkRelease: row.apk_release,
      status: row.status,
      createdAt: row.created_at,
      x86_64BuildStdout: "", // Don't load logs in list view
      x86_64BuildStderr: "", // Don't load logs in list view
      x86_64BuildExitCode: row.x86_64_build_exit_code,
      x86_64BuildCommand: row.x86_64_build_command,
      x86_64BuildStartedAt: row.x86_64_build_started_at,
      x86_64BuildFinishedAt: row.x86_64_build_finished_at,
      x86_64BuilderID: row.x86_64_builder_id,
      aarch64BuildStdout: "", // Don't load logs in list view
      aarch64BuildStderr: "", // Don't load logs in list view
      aarch64BuildExitCode: row.aarch64_build_exit_code,
      aarch64BuildCommand: row.aarch64_build_command,
      aarch64BuildStartedAt: row.aarch64_build_started_at,
      aarch64BuildFinishedAt: row.aarch64_build_finished_at,
      aarch64BuilderID: row.aarch64_builder_id,
      x86_64_publishOutput: "", // Don't load logs in list view
      aarch64_publishOutput: "", // Don't load logs in list view
      useRoot: row.use_root,
      bootstrapEnabled: row.bootstrap_enabled,
      bootstrapApkRepository: row.bootstrap_apk_repository,
      bootstrapKeyringAppend: row.bootstrap_keyring_append,
      cause: row.cause,
      causeId: row.cause_id
    }));

    return { executions, totalCount };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function countSuccessExecutions(timePeriod: "1hr" | "4h" | "1d"): Promise<number> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Convert time period to PostgreSQL interval format
    let interval: string;
    switch (timePeriod) {
      case "1hr":
        interval = "1 hour";
        break;
      case "4h":
        interval = "4 hours";
        break;
      case "1d":
        interval = "1 day";
        break;
      default:
        interval = "1 hour";
    }

    const query = `
      select count(*) from execution where created_at > now() - interval '${interval}' and status = 'success'
    `;

    const result = await db.query(query);
    return parseInt(result.rows[0].count);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function countFailedExecutions(timePeriod: "1hr" | "4h" | "1d"): Promise<number> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Convert time period to PostgreSQL interval format
    let interval: string;
    switch (timePeriod) {
      case "1hr":
        interval = "1 hour";
        break;
      case "4h":
        interval = "4 hours";
        break;
      case "1d":
        interval = "1 day";
        break;
      default:
        interval = "1 hour";
    }

    const query = `
      select count(*) from execution where created_at > now() - interval '${interval}' and (status = 'failed' OR status = 'timed_out' OR status = 'stalled')
    `;

    const result = await db.query(query);
    return parseInt(result.rows[0].count);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function countFailedExecutionsByType(timePeriod: "1hr" | "4h" | "1d"): Promise<{failed: number, timedOut: number, stalled: number}> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Convert time period to PostgreSQL interval format
    let interval: string;
    switch (timePeriod) {
      case "1hr":
        interval = "1 hour";
        break;
      case "4h":
        interval = "4 hours";
        break;
      case "1d":
        interval = "1 day";
        break;
      default:
        interval = "1 hour";
    }

    const query = `
      select
        count(*) filter (where status = 'failed') as failed,
        count(*) filter (where status = 'timed_out') as timed_out,
        count(*) filter (where status = 'stalled') as stalled
      from execution
      where created_at > now() - interval '${interval}'
    `;

    const result = await db.query(query);
    const row = result.rows[0];
    return {
      failed: parseInt(row.failed || '0'),
      timedOut: parseInt(row.timed_out || '0'),
      stalled: parseInt(row.stalled || '0')
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function countRunningExecutions(): Promise<number> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      select count(*) from execution where status = 'building' OR status = 'testing' OR status = 'publishing'
    `;

    const result = await db.query(query);
    return parseInt(result.rows[0].count);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function countWaitingForVMs(): Promise<number> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      select count(*) from work_queue where channel = 'build_package' and completed_at is null
    `;

    const result = await db.query(query);
    return parseInt(result.rows[0].count);
  } catch (err) {
    console.error(err);
    throw err;
  }
}
