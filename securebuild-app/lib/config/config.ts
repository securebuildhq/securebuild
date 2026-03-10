import { getDB } from "../data/db";
import { getParam } from "../data/param";
import parse from "parse-duration";

// Helper function to validate Go duration format using parse-duration
function isValidDuration(duration: string): boolean {
  try {
    const d = parse(duration);
    return d !== null && d > 0;
  } catch {
    return false;
  }
}

export async function getVMTTLDuration(): Promise<string> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `SELECT value FROM dynamic_config WHERE key = $1`;
    const result = await db.query(query, ['vm_ttl_duration']);

    if (result.rows.length === 0 || !result.rows[0].value) {
      return "24h"; // Default
    }

    return result.rows[0].value;
  } catch (err) {
    console.error('Failed to get VM TTL:', err);
    return "24h"; // Default on error
  }
}

export async function setVMTTLDuration(duration: string): Promise<void> {
  if (!duration || typeof duration !== 'string') {
    throw new Error('VM TTL duration must be a valid string');
  }

  if (!isValidDuration(duration)) {
    throw new Error('VM TTL duration must be in Go duration format (e.g., "24h", "2h30m", "45m")');
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    // Use INSERT ... ON CONFLICT to either insert or update
    const query = `
      INSERT INTO dynamic_config (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key)
      DO UPDATE SET value = $2
    `;

    await db.query(query, ['vm_ttl_duration', duration]);
  } catch (err) {
    console.error('Failed to set VM TTL:', err);
    throw new Error('Failed to update VM TTL configuration');
  }
}
