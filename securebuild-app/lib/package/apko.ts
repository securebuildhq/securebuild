import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { PackageGenerateApko } from "../types/apko";
import { logger } from "../utils/logger";
import * as srs from "secure-random-string";
import { enqueueWork } from "../utils/queue";

export async function createGenerateApko(userId: string, sessionId: string, melangeYaml: string): Promise<PackageGenerateApko> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const id = srs.default({ length: 24, alphanumeric: true });

    const query = `insert into package_generate_apko (id, user_id, session_id, melange_yaml, created_at) values ($1, $2, $3, $4, now())`;
    await db.query(query, [id, userId, sessionId, melangeYaml]);

    await enqueueWork("generate_apko", {
      id,
    });

    return {
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      melangeYaml,
    }

  } catch (error) {
    logger.error("Error creating generate apko", { error });
    throw error;
  }
}