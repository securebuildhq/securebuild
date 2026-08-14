"use server";

import { revalidatePath } from "next/cache";
import { createOrUpdateImageTest, deleteImageTest } from "../image-test";
import { enqueueWork } from "../../utils/queue";
import { getServerSession } from "@/lib/auth/server-session";

/**
 * Server action to create or update image test YAML
 */
export async function setImageTestAction(
  apkoId: string,
  apkoVersionId: string,
  testYaml: string,
  description?: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  try {
    await createOrUpdateImageTest(apkoId, apkoVersionId, testYaml, description);

    // Trigger GitHub sync to push test YAML to specs repo
    try {
      await enqueueWork("github_sync", {});
    } catch (syncErr) {
      console.warn("Failed to enqueue github_sync after updating image test:", syncErr);
    }

    // Revalidate the images page to reflect the changes
    revalidatePath("/images");

    return { success: true };
  } catch (error) {
    console.error("Error in setImageTestAction:", error);
    return {
      success: false,
      error: "Failed to save test YAML",
    };
  }
}

/**
 * Server action to delete image test YAML
 */
export async function deleteImageTestAction(
  apkoId: string,
  apkoVersionId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  try {
    await deleteImageTest(apkoId, apkoVersionId);

    // Trigger GitHub sync to push deletion to specs repo
    try {
      await enqueueWork("github_sync", {});
    } catch (syncErr) {
      console.warn("Failed to enqueue github_sync after deleting image test:", syncErr);
    }

    // Revalidate the images page to reflect the changes
    revalidatePath("/images");

    return { success: true };
  } catch (error) {
    console.error("Error in deleteImageTestAction:", error);
    return {
      success: false,
      error: "Failed to delete test YAML",
    };
  }
}
