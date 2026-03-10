import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { logger } from "../utils/logger";

export interface ScanResult {
  secureBuild: string
  alternate: string
}
export async function getScanResults(imageName: string, tag: string, arch: string): Promise<ScanResult> {
  logger.debug(`getting scan results for ${imageName} ${tag} ${arch}`);
  try {
    const db = getDB(await getParam("DB_URI"));

    let query;
    if (arch === "x86_64") {
      query = `select last_scan_result_x86 as securebuild, last_scan_result_alternate_x86 as alternate from image_catalog where name = $1 and tag = $2 and is_published = true`;
    } else if (arch === "arm64") {
      query = `select last_scan_result_aarch64 as securebuild, last_scan_result_alternate_aarch64 as alternate from image_catalog where name = $1 and tag = $2 and is_published = true`;
    } else {
      throw new Error(`Invalid architecture: ${arch}`);
  }

    const result = await db.query(query, [imageName, tag]);
    
    if (result.rows.length === 0) {
      return {
        secureBuild: "",
        alternate: "",
      };
    }
    
    return {
      secureBuild: result.rows[0].securebuild || "",
      alternate: result.rows[0].alternate || "",
    };
  } catch (err) {
    console.error(err);
    throw err;
  }
}