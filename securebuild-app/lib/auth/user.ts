import * as srs from "secure-random-string";
import { logger } from "@/lib/utils/logger";
import { getParam } from "@/lib/data/param";
import { getDB } from "@/lib/data/db";
import { User } from "@/lib/types/user";


export async function createToken(userId: string): Promise<string> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const token = srs.default({ length: 24, alphanumeric: true });

    const result = await db.query(
      `INSERT INTO user_token (user_id, token, created_at) VALUES ($1, $2, now())`,
      [userId, token],
    );

    if (result.rowCount !== 1) {
      throw new Error("Failed to create token");
    }

    return token;
  } catch (err) {
    logger.error("Failed to create token", { err });
    throw err;
  }
}

export async function upsertUserIfInvited(email: string, name: string, imageUrl: string, githubLogin: string): Promise<User> {
  const user = await findUser(email);
  if (user) {
    return user;
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    // check the public github membership and see if the the user is there
    const githubMembership = await fetch(`https://api.github.com/orgs/securebuildhq/members`);
    const githubMembers = await githubMembership.json();
    const isMember = githubMembers.some((member: any) => member.login === githubLogin);

    if (!isMember) {
      throw new Error("User is not a member of securebuildhq");
    }

    // the user will be admin only if there are no other admins in the database
    const existingAdminCount = await db.query(
      `SELECT COUNT(1) FROM buildadmin_user WHERE is_admin = true`,
    );
    const isAdmin = existingAdminCount.rows[0].count === 0;

    const id = srs.default({ length: 12, alphanumeric: true });

    await db.query(
      `INSERT INTO buildadmin_user (id, email, name, image_url, created_at, last_login_at, last_active_at, is_admin)
      VALUES ($1, $2, $3, $4, now(), now(), now(), $5)
        `,
      [id, email, name, imageUrl, isAdmin],
    );


    return {
      id: id,
      email: email,
      name: name,
      imageUrl: imageUrl,
      createdAt: new Date(),
      lastLoginAt: new Date(),
      lastActiveAt: new Date(),
      isAdmin: isAdmin,
    };
  } catch (err) {
    logger.error("Failed to upsert user", { err });
    throw err;
  }
}

export async function listUsers(): Promise<User[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(
      `SELECT id, email, name, image_url, created_at, last_login_at, last_active_at, is_admin FROM buildadmin_user`,
    );

    const users: User[] = [];
    for (const row of result.rows) {
      users.push({
        id: row.id,
        email: row.email,
        name: row.name,
        imageUrl: row.image_url,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        lastActiveAt: row.last_active_at,
        isAdmin: row.is_admin,
      });
    }

    return users;
  } catch (err) {
    logger.error("Failed to list users", { err });
    throw err;
  }
}

export async function findUser(email: string): Promise<User | undefined> {
  console.log(`finding user ${email}`);
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(
      `
            SELECT
                buildadmin_user.id,
                buildadmin_user.email,
                buildadmin_user.name,
                buildadmin_user.image_url,
                buildadmin_user.created_at,
                buildadmin_user.last_login_at,
                buildadmin_user.last_active_at,
                buildadmin_user.is_admin
            FROM
                buildadmin_user
            WHERE
                buildadmin_user.email = $1
        `,
      [email],
    );

    if (result.rows.length === 0) {
      return;
    }

    const row = result.rows[0];

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      imageUrl: row.image_url,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      lastActiveAt: row.last_active_at,
      isAdmin: row.is_admin,
    };
  } catch (err) {
    logger.error("Failed to find user", { err });
    throw err;
  }
}

export async function getUser(id: string): Promise<User | undefined> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(
      `
            SELECT
                buildadmin_user.id,
                buildadmin_user.email,
                buildadmin_user.name,
                buildadmin_user.image_url,
                buildadmin_user.created_at,
                buildadmin_user.last_login_at,
                buildadmin_user.last_active_at,
                buildadmin_user.is_admin
            FROM
                buildadmin_user
            WHERE
                buildadmin_user.id = $1
        `,
      [id],
    );

    if (result.rows.length === 0) {
      return;
    }

    const row = result.rows[0];

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      imageUrl: row.image_url,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      lastActiveAt: row.last_active_at,
      isAdmin: row.is_admin,
    };
  } catch (err) {
    logger.error("Failed to get user", { err });
    throw err;
  }
}
