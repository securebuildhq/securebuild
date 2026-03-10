import * as srs from "secure-random-string";
import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { Team } from "../types/team";
import { getUser } from "../user/user";
import Stripe from 'stripe';
import { Invite } from "../types/invite";
import { User } from "../types/user";
import { enqueueWork } from "../utils/queue";

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16' as any, // Using 'as any' to bypass potential strict type checks for now
    });
  }
  return stripe;
}

export async function setTeamName(id: string, name: string): Promise<Team> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await db.query(`update securebuild_team set name = $1 where id = $2`, [name, id]);

    return getTeam(id);
  } catch (err) {
    console.error(`set team name`, err);
    throw err;
  }
}

export async function addUserToTeam(userId: string, teamId: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await db.query(`insert into user_team (user_id, team_id) values ($1, $2) ON CONFLICT (user_id, team_id) DO NOTHING`, [userId, teamId]);
  } catch (err) {
    console.error(`add user to team`, err);
    throw err;
  }
}

export async function removeUserFromTeam(userId: string, teamId: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await db.query(`delete from user_team where user_id = $1 and team_id = $2`, [userId, teamId]);
  } catch (err) {
    console.error(`remove user from team`, err);
    throw err;
  }
}

export async function deleteTeamInvite(id: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await db.query(`delete from securebuild_invite where id = $1`, [id]);
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function listTeamInvites(teamId: string): Promise<Invite[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(`select id, team_id, email, role, created_at from securebuild_invite where team_id = $1`, [teamId]);
    const invites: Invite[] = result.rows.map((row) => ({
      id: row.id,
      teamId: row.team_id,
      email: row.email,
      role: row.role as 'admin' | 'developer' | 'viewer',
      createdAt: row.created_at,
    }));

    return invites;
  } catch (err) {
    console.error(`list team invites`, err);
    throw err;
  }
}

export async function listTeamUsers(teamId: string): Promise<User[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(`select id, email, first_name, last_name, picture, created_at, last_login_at, last_active_at, hosted_domain, role from securebuild_user where id in (select user_id from user_team where team_id = $1)`, [teamId]);
    const users: User[] = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      picture: row.picture,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      hostedDomain: row.hosted_domain,
      roles: row.role as 'admin' | 'developer' | 'viewer',
    }));

    return users;
  } catch (err) {
    console.error(`list team users`, err);
    throw err;
  }
}

export async function getInviteById(id: string): Promise<Invite | undefined> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(`select id, team_id, team_id, email, role, created_at, last_sent_at from securebuild_invite where id = $1`, [id]);

    if (result.rows.length === 0) {
      return undefined;
    }

    return {
      id: result.rows[0].id,
      teamId: result.rows[0].team_id,
      email: result.rows[0].email,
      role: result.rows[0].role,
      createdAt: result.rows[0].created_at,
    }
  } catch (err) {
    console.error(`get invite`, err);
    throw err;
  }
}

export async function getInviteByToken(token: string): Promise<Invite> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(`select id, team_id, team_id, email, role, created_at, last_sent_at from securebuild_invite where token = $1`, [token]);

    if (result.rows.length === 0) {
      throw new Error(`Invite not found with token: ${token}`);
    }

    return {
      id: result.rows[0].id,
      teamId: result.rows[0].team_id,
      email: result.rows[0].email,
      role: result.rows[0].role,
      createdAt: result.rows[0].created_at,
    }
  } catch (err) {
    console.error(`get invite`, err);
    throw err;
  }
}

export async function inviteTeamMember(teamId: string, email: string, role: "admin" | "developer" | "viewer"): Promise<Invite> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const id = srs.default({ length: 12, alphanumeric: true });
    const token = srs.default({ length: 8, alphanumeric: true });
    const createdAt = new Date();

    await db.query(`insert into securebuild_invite (id, team_id, email, role, created_at, token) values ($1, $2, $3, $4, $5, $6)`,
      [id, teamId, email, role, createdAt, token]);

    await enqueueWork('send_email', {
      'event': 'invite_team_member',
      'data': {
        'invite_id': id,
        'team_id': teamId,
        'email': email,
        'role': role,
      }
    })

    return {
      id,
      teamId,
      email,
      role,
      createdAt: createdAt.toISOString(),
    };
  } catch (err) {
    console.error(`invite team member`, err);
    throw err;
  }
}

export async function listUserTeams(userId: string): Promise<Team[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const teamsResult = await db.query(
      `
        SELECT id, name, payment_email, registry_username, full_catalog_access, feature_flags FROM securebuild_team WHERE id IN (SELECT team_id FROM user_team WHERE user_id = $1)
      `,
      [userId],
    );

    const teams = teamsResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      paymentEmail: row.payment_email,
      registryUsername: row.registry_username,
      full_catalog_access: row.full_catalog_access,
      feature_flags: row.feature_flags || [],
    }));

    return teams;
  } catch (error) {
    console.error("Error listing user teams:", error);
    throw error;
  }
}

function extractDomainWithoutTLD(hostedDomain: string, firstName: string, lastName: string, email: string): string {
  if (!hostedDomain) {
    if (firstName || lastName) {
    // Fallback to old logic using user's name
      const name = `${firstName} ${lastName}`;
      return name.toLowerCase().replace(/\s+/g, '-');
    }

    return email.toLowerCase();
  }

  // Remove everything after the last dot to get domain without TLD
  const parts = hostedDomain.split('.');
  if (parts.length > 1) {
    return parts[0].toLowerCase().replace(/[^a-z0-9]/g, '-');
  }

  // If no dots found, use the whole string
  return hostedDomain.toLowerCase().replace(/[^a-z0-9]/g, '-');
}

export async function createUserDefaultTeam(userId: string): Promise<Team> {
  const user = await getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }

  // if the user it not already on a team, create a default team for them
  const teams = await listUserTeams(userId);
  if (teams.length > 0) {
    return teams[0];
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    const id = srs.default({ length: 12, alphanumeric: true });
    const name = user.firstName || user.lastName ? `${user.firstName} ${user.lastName}` : `${user.email}'s Team`;
    const registryUsername = extractDomainWithoutTLD(user.hostedDomain, user.firstName, user.lastName, user.email);

    await db.query(
      `
        INSERT INTO securebuild_team (id, name, payment_email, registry_username, created_at) VALUES ($1, $2, $3, $4, now())
      `,
      [id, name, user.email, registryUsername],
    );

    await db.query(
      `
        INSERT INTO user_team (user_id, team_id) VALUES ($1, $2)
      `,
      [userId, id],
    );

    return {
      id,
      name: `${user.firstName} ${user.lastName}`,
      paymentEmail: user.email,
      registryUsername: registryUsername,
      full_catalog_access: false,
      feature_flags: [],
    };
  } catch (error) {
    console.error("Error creating user default team:", error);
    throw error;
  }
}

export async function getStripeCustomerId(teamId: string): Promise<string> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `
        SELECT stripe_customer_id FROM securebuild_team WHERE id = $1
      `,
      [teamId],
    );

    if (!result.rows[0].stripe_customer_id) {
      return createStripeCustomerId(teamId);
    }

    return result.rows[0].stripe_customer_id;
  } catch (error) {
    console.error("Error getting stripe customer id:", error);
    throw error;
  }
}

export async function getTeamNameForInvite(id: string): Promise<string>{
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `
        SELECT name FROM securebuild_team WHERE id = (select team_id from securebuild_invite where id = $1)
      `,
      [id],
    );

    return result.rows[0].name;
  } catch (error) {
    console.error("Error getting team:", error);
    throw error;
  }
}

export async function getTeam(id: string): Promise<Team> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(`select id, name, payment_email, registry_username, full_catalog_access, feature_flags from securebuild_team where id = $1`, [id]);
    const team: Team = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      paymentEmail: result.rows[0].payment_email,
      registryUsername: result.rows[0].registry_username,
      full_catalog_access: result.rows[0].full_catalog_access,
      feature_flags: result.rows[0].feature_flags || [],
    };
    return team;
  } catch (error) {
    console.error("Error getting team:", error);
    throw error;
  }
}

async function createStripeCustomerId(teamId: string): Promise<string> {
  const team = await getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  try {
    const customers = await getStripe().customers.list({ email: team.paymentEmail, limit: 1 });
    const customerId = customers.data.length > 0
      ? customers.data[0].id
      : (await getStripe().customers.create({
          email: team.paymentEmail,
          name: team.name,
        })).id;

    const db = getDB(await getParam("DB_URI"));
    await db.query(
      `
        UPDATE securebuild_team SET stripe_customer_id = $1 WHERE id = $2
      `,
      [customerId, teamId],
    );

    return customerId;
  } catch (error) {
    console.error("Error creating stripe customer id:", error);
    throw error;
  }
}

