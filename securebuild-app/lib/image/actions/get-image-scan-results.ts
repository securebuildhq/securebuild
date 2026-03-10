"use server"

import { Session } from "@/lib/types/session";
import { getImageScanResults, getImageScanResultById, ImageScanSummary, ImageScanResult } from "../scan";
import { getParam } from "@/lib/data/param";

export async function getImageScanResultsAction(sess: Session, imageName: string): Promise<ImageScanSummary[]> {
  const cve0OciHost = await getParam("CVE0_OCI_HOST");
  return await getImageScanResults(`${cve0OciHost}/${imageName}`);
}

export async function getImageScanResultByIdAction(sess: Session, scanId: string): Promise<ImageScanResult | null> {
  return await getImageScanResultById(scanId);
}

export async function downloadImageScanResultAction(sess: Session, scanId: string): Promise<any> {
  const scanResult = await getImageScanResultById(scanId);
  
  if (!scanResult) {
    throw new Error("Scan result not found");
  }
  
  return scanResult.result;
}