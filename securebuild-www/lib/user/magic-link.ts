import * as srs from "secure-random-string";
import { getDB } from "../data/db";
import { logger } from "../utils/logger";
import { enqueueWork } from "../utils/queue";
import { getParam } from "../data/param";


export async function createAndSendMagicLink(email: string) {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Generate a 6-digit numeric code
    const nonce = Math.floor(100000 + Math.random() * 900000).toString();
    const id = srs.default({ length: 12, alphanumeric: true });

    // Calculate expiry on the client side (15 minutes from now)
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 15 * 60 * 1000);

    // Store the nonce in the database
    await db.query(
      `INSERT INTO passwordless_login_nonce (id, email, nonce, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, email.toLowerCase(), nonce, createdAt, expiresAt]
    );

    // Enqueue email sending work
    await enqueueWork("send_email", {
      event: "magic_link",
      data: {
        email: email.toLowerCase(),
        code: nonce
      }
    });
  } catch (error) {
    logger.error("Failed to create and send magic link", { error });
    throw error;
  }
}

export async function verifyMagicLink(email: string, code: string): Promise<string | undefined> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `SELECT id, expires_at FROM passwordless_login_nonce WHERE email = $1 AND nonce = $2`,
      [email.toLowerCase(), code]
    );

    if (result.rows.length === 0) {
      return;
    }

    if (result.rows[0].expires_at < new Date()) {
      return;
    }

    return result.rows[0].id;
  } catch (error) {
    logger.error("Failed to verify magic link", { error });
    throw error;
  }
}