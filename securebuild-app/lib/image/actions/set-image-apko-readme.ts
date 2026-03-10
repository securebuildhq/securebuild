"use server"

import { ImageAPKO } from "@/lib/types/image";
import { Session } from "@/lib/types/session";
import { setImageApkoReadme } from "../image";

export async function setImageApkoReadmeAction(sess: Session, apkoId: string, readme: string): Promise<ImageAPKO> {
  return await setImageApkoReadme(apkoId, readme);
}