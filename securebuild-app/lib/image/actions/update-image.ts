"use server"

import { Image } from "@/lib/types/image";
import { Session } from "@/lib/types/session";
import { updateImageAPKOYaml } from "../image";

export async function updateImageApkoYamlAction(sess: Session, imageId: string, apkoId: string, yaml: string): Promise<void> {
  await updateImageAPKOYaml(imageId, apkoId, yaml);
}