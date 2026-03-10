import { getDB } from "../data/db";
import { getParam } from "../data/param";

export interface UserTeam {
  id: string;
  name: string;
}

export interface UserWithTeam {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  teams: UserTeam[];
}

export async function listUsersWithTeams(): Promise<UserWithTeam[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(`
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.created_at,
        u.last_login_at,
        COALESCE(
          array_agg(
            CASE
              WHEN t.id IS NOT NULL
              THEN json_build_object('id', t.id, 'name', t.name)
              ELSE NULL
            END
          ) FILTER (WHERE t.id IS NOT NULL),
          '{}'
        ) as teams
      FROM securebuild_user u
      LEFT JOIN user_team ut ON u.id = ut.user_id
      LEFT JOIN securebuild_team t ON ut.team_id = t.id
      GROUP BY u.id, u.email, u.first_name, u.last_name, u.created_at, u.last_login_at
      ORDER BY u.created_at DESC
    `);

    const users: UserWithTeam[] = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      teams: row.teams || [],
    }));

    return users;
  } catch (err) {
    console.error(`listUsersWithTeams`, err);
    throw err;
  }
}
