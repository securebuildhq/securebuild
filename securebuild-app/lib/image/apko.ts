import { getDB } from "../data/db"
import { getParam } from "../data/param"
import { ValidationError } from "@/lib/errors/validation-error"
import { randomUUID } from "crypto"
import { enqueueWork } from "../utils/queue"
import { getImageTestForLatestVersion, createOrUpdateImageTest } from "./image-test"

interface ApkoVersion {
  apkoId: string
  apkoYaml: string
}

export async function getLatestImageApkoYaml(imageName: string, imageTag: string): Promise<ApkoVersion | null> {
  try {
    const db = getDB(await getParam("DB_URI"))
    
    // First get the image_apko_id for the image name and tag
    const apkoQuery = `
      SELECT ia.id as image_apko_id
      FROM image_apko ia
      JOIN image i ON i.id = ia.image_id
      WHERE i.name = $1
        AND $2 = ANY(ia.tags)
      ORDER BY ia.created_at DESC
      LIMIT 1
    `

    const apkoResult = await db.query(apkoQuery, [imageName, imageTag])
    
    if (apkoResult.rows.length === 0) {
      return null
    }

    const imageApkoId = apkoResult.rows[0].image_apko_id

    // Now get the latest APKO YAML for this image_apko_id
    const versionQuery = `
      SELECT apko_yaml, created_at
      FROM image_apko_version
      WHERE image_apko_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `

    const versionResult = await db.query(versionQuery, [imageApkoId])
    
    if (versionResult.rows.length === 0) {
      return null
    }

    const row = versionResult.rows[0]
    return {
      apkoId: imageApkoId,
      apkoYaml: row.apko_yaml
    }

  } catch (err) {
    console.error(err)
    throw err
  }
}

export async function createApkoVersion(apkoId: string, apkoYaml: string): Promise<void> {
  try {
    // Validate inputs
    if (!apkoId) {
      throw new ValidationError('apkoId is required')
    }
    if (!apkoYaml) {
      throw new ValidationError('apkoYaml is required')
    }

    // Verify apkoId exists
    const db = getDB(await getParam("DB_URI"))
    const checkQuery = `
      SELECT id FROM image_apko WHERE id = $1
    `
    const checkResult = await db.query(checkQuery, [apkoId])
    if (checkResult.rows.length === 0) {
      throw new ValidationError('Invalid apkoId')
    }

    // Get existing test from the latest version before creating new version
    const existingTest = await getImageTestForLatestVersion(apkoId)

    // Create new version
    const insertQuery = `
      INSERT INTO image_apko_version (
        id,
        image_apko_id,
        created_at,
        updated_at,
        apko_yaml
      ) VALUES (
        $1,
        $2,
        NOW(),
        NOW(),
        $3
      )
    `

    const versionId = randomUUID()
    await db.query(insertQuery, [versionId, apkoId, apkoYaml])

    // Copy the test from the previous version to the new version
    if (existingTest) {
      try {
        await createOrUpdateImageTest(apkoId, versionId, existingTest.yamlContent, existingTest.description ?? undefined)
      } catch (testErr) {
        console.warn("Failed to copy test to new APKO version:", testErr)
      }
    }

    // Trigger GitHub sync after image APKO version creation
    try {
      await enqueueWork("github_sync", {})
    } catch (syncErr) {
      console.warn("Failed to enqueue github_sync after image APKO version creation:", syncErr)
    }

  } catch (err) {
    console.error(err)
    throw err
  }
}
