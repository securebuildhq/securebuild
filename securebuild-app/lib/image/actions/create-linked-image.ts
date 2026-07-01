"use server"

import { Image } from "@/lib/types/image";
import { Session } from "@/lib/types/session";
import { ValidationError } from "@/lib/types/errors";
import { createLinkedImage } from "../image";

export interface CreateLinkedImageRequest {
  name: string;
  gitRemote: string;
  apkoFilePath: string;
  testFilePath?: string;
  imageTagTemplate: string;
  gitTag: string;
}

async function createLinkedImageActionImpl(session: Session, req: CreateLinkedImageRequest): Promise<Image> {
  if (!session?.user) {
    throw new Error("Unauthorized: Valid session required");
  }

  if (!req.name?.trim()) {
    throw new ValidationError("Image name is required");
  }
  if (!req.gitRemote?.trim()) {
    throw new ValidationError("Git remote is required");
  }
  if (!req.apkoFilePath?.trim()) {
    throw new ValidationError("APKO file path is required");
  }
  if (!req.imageTagTemplate?.trim()) {
    throw new ValidationError("Image tag template is required");
  }
  if (!req.gitTag?.trim()) {
    throw new ValidationError("Git tag is required");
  }

  return await createLinkedImage(req);
}

export const createLinkedImageAction = createLinkedImageActionImpl;
