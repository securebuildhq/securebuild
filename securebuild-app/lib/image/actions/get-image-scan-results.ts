"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getImageScanResults, getImageScanResultById, ImageScanSummary, ImageScanResult } from "../scan";
import { getParam } from "@/lib/data/param";

export async function getImageScanResultsAction(imageName: string): Promise<ImageScanSummary[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const ociImagePrefix = await getParam("OCI_IMAGE_PREFIX");
  const registryImagePrefix = await getParam("REGISTRY_IMAGE_PREFIX");
  const prefix = ociImagePrefix || registryImagePrefix;
  return await getImageScanResults(`${prefix}/${imageName}`);
}

export async function getImageScanResultByIdAction(scanId: string): Promise<ImageScanResult | null> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await getImageScanResultById(scanId);
}

export async function downloadImageScanResultAction(scanId: string): Promise<any> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const scanResult = await getImageScanResultById(scanId);
  
  if (!scanResult) {
    throw new Error("Scan result not found");
  }
  
  return scanResult.result;
}