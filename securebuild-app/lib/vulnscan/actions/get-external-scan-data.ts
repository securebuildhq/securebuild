"use server";

import { getServerSession } from "@/lib/auth/server-session";

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
  timePeriod?: TimePeriod
): Promise<ExternalScanCounts> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return getExternalScanCounts(timePeriod);
}

export async function getExternalSBOMCountsAction(
  timePeriod?: TimePeriod
): Promise<ExternalSBOMCounts> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return getExternalSBOMCounts(timePeriod);
}

export async function getExternalScanThroughputAction(
  timePeriod?: TimePeriod
): Promise<ExternalScanThroughput> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return getExternalScanThroughput(timePeriod);
}

export async function listExternalScansAction(
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
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

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
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const { statuses, totalCount } = await listExternalSBOMStatuses(filters, pagination);
  const serialized: SerializedExternalSBOMStatusItem[] = statuses.map((s) => ({
    ...s,
    createdAt: s.createdAt?.toISOString() || "",
    updatedAt: s.updatedAt?.toISOString() || null,
    statusUpdatedAt: s.statusUpdatedAt?.toISOString() || null,
  }));
  return { statuses: serialized, totalCount };
}
