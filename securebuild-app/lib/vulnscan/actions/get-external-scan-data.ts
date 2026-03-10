"use server";

import { Session } from "@/lib/types/session";
import {
  getExternalScanCounts,
  getExternalSBOMCounts,
  getExternalScanThroughput,
  listExternalScans,
  listExternalSBOMStatuses,
  ExternalScanCounts,
  ExternalSBOMCounts,
  ExternalScanThroughput,
  TimePeriod,
} from "../vulnscan";

export interface SerializedExternalScanItem {
  digest: string;
  arch: string;
  status: string;
  scanStatusMessage: string | null;
  createdAt: string;
  updatedAt: string | null;
  scanAttemptedAt: string | null;
  scanCompletedAt: string | null;
  scanStatusUpdatedAt: string | null;
  registry: string | null;
  imageName: string | null;
  imageTag: string | null;
}

export interface SerializedExternalSBOMStatusItem {
  digest: string;
  status: string;
  statusMessage: string | null;
  createdAt: string;
  updatedAt: string | null;
  statusUpdatedAt: string | null;
  registry: string | null;
  imageName: string | null;
  imageTag: string | null;
}

export async function getExternalScanCountsAction(
  sess: Session,
  timePeriod?: TimePeriod
): Promise<ExternalScanCounts> {
  if (!sess?.user) throw new Error("Unauthorized: Valid session required");
  return getExternalScanCounts(timePeriod);
}

export async function getExternalSBOMCountsAction(
  sess: Session,
  timePeriod?: TimePeriod
): Promise<ExternalSBOMCounts> {
  if (!sess?.user) throw new Error("Unauthorized: Valid session required");
  return getExternalSBOMCounts(timePeriod);
}

export async function getExternalScanThroughputAction(
  sess: Session,
  timePeriod?: TimePeriod
): Promise<ExternalScanThroughput> {
  if (!sess?.user) throw new Error("Unauthorized: Valid session required");
  return getExternalScanThroughput(timePeriod);
}

export async function listExternalScansAction(
  sess: Session,
  filters: {
    status?: string;
    timePeriod?: TimePeriod;
    registry?: string;
    image?: string;
    tag?: string;
    digest?: string;
  } = {},
  pagination?: { page?: number; limit?: number }
): Promise<{ scans: SerializedExternalScanItem[]; totalCount: number }> {
  if (!sess?.user) throw new Error("Unauthorized: Valid session required");
  const { scans, totalCount } = await listExternalScans(filters, pagination);
  const serialized: SerializedExternalScanItem[] = scans.map((s) => ({
    ...s,
    createdAt: s.createdAt?.toISOString() || "",
    updatedAt: s.updatedAt?.toISOString() || null,
    scanAttemptedAt: s.scanAttemptedAt?.toISOString() || null,
    scanCompletedAt: s.scanCompletedAt?.toISOString() || null,
    scanStatusUpdatedAt: s.scanStatusUpdatedAt?.toISOString() || null,
  }));
  return { scans: serialized, totalCount };
}

export async function listExternalSBOMStatusesAction(
  sess: Session,
  filters: {
    status?: string;
    timePeriod?: TimePeriod;
    registry?: string;
    image?: string;
    tag?: string;
    digest?: string;
  } = {},
  pagination?: { page?: number; limit?: number }
): Promise<{ statuses: SerializedExternalSBOMStatusItem[]; totalCount: number }> {
  if (!sess?.user) throw new Error("Unauthorized: Valid session required");
  const { statuses, totalCount } = await listExternalSBOMStatuses(filters, pagination);
  const serialized: SerializedExternalSBOMStatusItem[] = statuses.map((s) => ({
    ...s,
    createdAt: s.createdAt?.toISOString() || "",
    updatedAt: s.updatedAt?.toISOString() || null,
    statusUpdatedAt: s.statusUpdatedAt?.toISOString() || null,
  }));
  return { statuses: serialized, totalCount };
}
