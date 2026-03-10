"use server"

import { Session } from "@/lib/types/session";
import { enqueueWork } from "@/lib/utils/queue";
import { getDB } from "@/lib/data/db";

export async function triggerPackageFamilyUpdateCheckAction(session: Session, packageFamilyId: string): Promise<{ success: boolean; message: string }> {
  // TODO: Add session validation when implemented

  try {
    // Enqueue the update check
    await enqueueWork("package_family_update_check", {
      packageFamilyId: packageFamilyId
    });

    // Reset the schedule: next check = now + check_frequency_minutes
    const pool = getDB(process.env.DB_URI!);
    const client = await pool.connect();
    try {
      await client.query(`
        UPDATE package_family
        SET check_for_updates_at = NOW() + (check_frequency_minutes || ' minutes')::interval
        WHERE id = $1
      `, [packageFamilyId]);
    } finally {
      client.release();
    }

    return {
      success: true,
      message: "Update check has been queued to look for new versions"
    };
  } catch (error) {
    console.error("Failed to trigger package family update check:", error);
    return {
      success: false,
      message: "Failed to queue update check. Please try again."
    };
  }
}