import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

export interface TestSession {
  sessionId: string;
  userId: string;
  jwtToken: string;
  expiresAt: Date;
}

/**
 * Generates a JWT token for a test buildadmin_session that exists in seed data
 *
 * Note: The session must already exist in the database via SchemaHero seed data.
 * This function queries the database to get the session details and generates the JWT token.
 *
 * @param pool - Database connection pool
 * @param sessionId - The session ID (must match seed data)
 * @returns TestSession with sessionId, userId (from DB), JWT token, and expiresAt (from DB)
 */
export async function createTestSession(
  pool: Pool,
  sessionId: string
): Promise<TestSession> {
  // Query the database to get session details from seed data
  const result = await pool.query(
    `SELECT id, user_id, expires_at FROM buildadmin_session WHERE id = $1`,
    [sessionId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Session ${sessionId} not found in database. Ensure seed data is loaded.`);
  }

  const session = result.rows[0];
  const expiresAt = new Date(session.expires_at);

  // Generate JWT token (same way the app does it)
  const hmacSecret = process.env.HMAC_SECRET || 'test-secret-for-integration-tests';
  const jwtToken = jwt.sign({ id: sessionId }, hmacSecret);

  console.log(`Generated JWT for test session: ${sessionId} for user: ${session.user_id}`);

  return {
    sessionId: session.id,
    userId: session.user_id,
    jwtToken,
    expiresAt
  };
}
