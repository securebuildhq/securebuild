import { getDB } from "../data/db";
import { getParam } from "../data/param";
import * as srs from "secure-random-string";

/**
 * Get all custom build images configured for a team
 */
export async function getTeamCustomBuildImages(teamId: string): Promise<string[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      SELECT image_name
      FROM team_custom_build_image
      WHERE team_id = $1
      ORDER BY image_name ASC
    `;

    const result = await db.query(query, [teamId]);
    return result.rows.map(row => row.image_name);
  } catch (error) {
    console.error('Error getting team custom build images:', error);
    throw error;
  }
}

/**
 * Add a custom build image for a team
 */
export async function addTeamCustomBuildImage(
  teamId: string,
  imageName: string
): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const id = 'tcbi_' + srs.default({ length: 32, alphanumeric: true });

    const query = `
      INSERT INTO team_custom_build_image
      (id, team_id, image_name, created_at, updated_at)
      VALUES ($1, $2, $3, now(), now())
      ON CONFLICT (team_id, image_name) DO NOTHING
    `;

    await db.query(query, [id, teamId, imageName]);
  } catch (error) {
    console.error('Error adding team custom build image:', error);
    throw error;
  }
}

/**
 * Remove a custom build image for a team
 */
export async function removeTeamCustomBuildImage(
  teamId: string,
  imageName: string
): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      DELETE FROM team_custom_build_image
      WHERE team_id = $1 AND image_name = $2
    `;

    await db.query(query, [teamId, imageName]);
  } catch (error) {
    console.error('Error removing team custom build image:', error);
    throw error;
  }
}

/**
 * Get all available images (for dropdown in UI)
 */
export async function getAllImages(): Promise<Array<{ id: string; name: string }>> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      SELECT id, name
      FROM image
      ORDER BY name ASC
    `;

    const result = await db.query(query);
    return result.rows.map(row => ({
      id: row.id,
      name: row.name
    }));
  } catch (error) {
    console.error('Error getting all images:', error);
    throw error;
  }
}
