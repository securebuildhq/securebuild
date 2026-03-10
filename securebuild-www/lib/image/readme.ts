import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { logger } from "../utils/logger";

export async function getImageReadme(id: string, tag: string): Promise<string | null> {
  logger.debug(`Getting readme for image ${id} with tag ${tag}`);
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select readme from image_catalog where image_id = $1 and tag = $2 and is_published = true`;
    const result = await db.query(query, [id, tag]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].readme;
  } catch (err) {
    console.error(err);
    throw err;
  }
}