"use server"

import { Image } from "@/lib/types/image";
import { getServerSession } from "@/lib/auth/server-session";
import { ValidationError } from "@/lib/types/errors";
import { createImage } from "../image";
import { traceServerAction } from "@/lib/observability/tracing";


export interface CreateImageAPKO {
  name: string;
  yaml: string;
  tags: string[];
}

function validateImageName(name: string): void {
  if (!name) {
    throw new ValidationError("Image name is required");
  }

  if (name.length < 2) {
    throw new ValidationError("Image name must be at least 2 characters long");
  }

  if (name.length > 255) {
    throw new ValidationError("Image name must be less than 255 characters long");
  }

  // Must start with lowercase alphanumeric character
  if (!/^[a-z0-9]/.test(name)) {
    throw new ValidationError("Image name must start with a lowercase letter or number");
  }

  // Must end with lowercase alphanumeric character
  if (!/[a-z0-9]$/.test(name)) {
    throw new ValidationError("Image name must end with a lowercase letter or number");
  }

  // Can only contain lowercase letters, digits, dots, dashes, and underscores
  if (!/^[a-z0-9._-]+$/.test(name)) {
    throw new ValidationError("Image name can only contain lowercase letters, numbers, dots, dashes, and underscores");
  }

  // Cannot have consecutive dots
  if (/\.{2,}/.test(name)) {
    throw new ValidationError("Image name cannot have consecutive dots");
  }

  // Cannot start or end with dots, dashes, or underscores
  if (/^[._-]|[._-]$/.test(name)) {
    throw new ValidationError("Image name cannot start or end with dots, dashes, or underscores");
  }
}

async function createImageActionImpl(name: string, alternateImage: string, apkos: CreateImageAPKO[]): Promise<Image> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // Validate image name first
  validateImageName(name);

  // Validate that all tags are unique across all APKO configurations
  const allTags: string[] = [];
  const duplicateTags: string[] = [];

  for (const apko of apkos) {
    for (const tag of apko.tags) {
      if (allTags.includes(tag)) {
        if (!duplicateTags.includes(tag)) {
          duplicateTags.push(tag);
        }
      } else {
        allTags.push(tag);
      }
    }
  }

  if (duplicateTags.length > 0) {
    throw new ValidationError(`Duplicate tags found across APKO configurations: ${duplicateTags.join(', ')}. Each tag must be unique across all APKOs.`);
  }

  const image = await createImage(name, alternateImage, apkos);
  return image;
}

export const createImageAction = traceServerAction('createImageAction', createImageActionImpl);
