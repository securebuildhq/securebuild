import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { User } from "../types/user";
import { logger } from "../utils/logger";
import * as srs from "secure-random-string";

export async function upsertUser(email: string, firstName: string, lastName: string, picture: string, hostedDomain: string): Promise<User> {
  const user = await findUser(email);
  if (user) {
    return user;
  }

  try {
    const db = getDB(await getParam("DB_URI"));
    const id = srs.default({ length: 12, alphanumeric: true });

    await db.query(
      `INSERT INTO securebuild_user (id, email, first_name, last_name, picture, hosted_domain, created_at, last_login_at, last_active_at, role) VALUES ($1, $2, $3, $4, $5, $6, now(), now(), now(), $7)`,
      [id, email, firstName, lastName, picture, hostedDomain, 'admin'],
    );

    return {
      id,
      email,
      firstName,
      lastName,
      picture,
      hostedDomain,
      createdAt: new Date(),
      lastLoginAt: new Date(),
      lastActiveAt: new Date(),
      roles: 'admin',
    };
  } catch (error) {
    logger.error("Failed to upsert user", { error });
    throw error;
  }
}

export async function findUser(email: string): Promise<User | undefined> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(
      `SELECT id, email, first_name, last_name, picture, hosted_domain, created_at, last_login_at, last_active_at, role FROM securebuild_user WHERE email = $1`,
      [email],
    );

    if (result.rows.length === 0) {
      return;
    }

    const user: User = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      firstName: result.rows[0].first_name,
      lastName: result.rows[0].last_name,
      picture: result.rows[0].picture,
      hostedDomain: result.rows[0].hosted_domain,
      createdAt: result.rows[0].created_at,
      lastLoginAt: result.rows[0].last_login_at,
      lastActiveAt: result.rows[0].last_active_at,
      roles: result.rows[0].role as 'admin' | 'developer' | 'viewer',
    };

    return user;
  } catch (error) {
    logger.error("Failed to find user", { error });
    throw error;
  }
}

export async function getUser(id: string): Promise<User | undefined> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(
      `SELECT id, email, first_name, last_name, picture, hosted_domain, created_at, last_login_at, last_active_at, role FROM securebuild_user WHERE id = $1`,
      [id],
    );

    const user: User = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      firstName: result.rows[0].first_name,
      lastName: result.rows[0].last_name,
      picture: result.rows[0].picture,
      hostedDomain: result.rows[0].hosted_domain,
      createdAt: result.rows[0].created_at,
      lastLoginAt: result.rows[0].last_login_at,
      lastActiveAt: result.rows[0].last_active_at,
      roles: result.rows[0].role as 'admin' | 'developer' | 'viewer',
    };

    return user;
  } catch (error) {
    logger.error("Failed to get user", { error });
    throw error;
  }
}