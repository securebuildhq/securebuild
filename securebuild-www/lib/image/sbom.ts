import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { logger } from "../utils/logger";

export async function getSbom(name: string, tag: string, arch: string): Promise<unknown> {
  logger.debug("getting sbom", { name, tag, arch });
  try {
    const db = getDB(await getParam("DB_URI"))

    let query;
    if (arch === "x86_64") {
      query = `select sbom_x86 as sbom from image_catalog where name = $1 and tag = $2 and is_published = true`;
    } else if (arch === "arm64") {
      query = `select sbom_aarch64 as sbom from image_catalog where name = $1 and tag = $2 and is_published = true`;
    } else {
      throw new Error("Invalid architecture");
    }

    const result = await db.query(query, [name, tag]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].sbom;
  } catch (err) {
    console.error(err);
    throw err;
  }
}
