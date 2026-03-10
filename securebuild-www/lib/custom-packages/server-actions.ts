"use server";

import { cookies } from "next/headers";
import { validateSession } from "../auth/actions/validate-session";
import { getCustomPackages, getCustomPackage, getCustomPackageVersions, getCustomPackageAdditionalFiles, getCustomPackageExecutions } from "./custom-package";
import { CustomPackage, CustomPackageVersion, CustomPackageVersionAdditionalFile } from "../types/custom-package";
import { traceServerAction } from "@/lib/observability/tracing";

async function getSessionFromCookies() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('session')?.value;
  
  if (!sessionToken) {
    throw new Error('No session found');
  }
  
  const session = await validateSession(sessionToken);
  if (!session) {
    throw new Error('Invalid session');
  }
  
  return session;
}

/**
 * Server action to get custom packages for the current team
 */
async function getCustomPackagesActionImpl(): Promise<CustomPackage[]> {
  const session = await getSessionFromCookies();
  if (!session?.selectedTeamId) {
    throw new Error('No team selected');
  }
  
  return await getCustomPackages(session.selectedTeamId);
}

export const getCustomPackagesAction = traceServerAction('getCustomPackagesAction', getCustomPackagesActionImpl);

/**
 * Server action to get a custom package by ID for the current team
 */
async function getCustomPackageActionImpl(packageId: string): Promise<CustomPackage | null> {
  const session = await getSessionFromCookies();
  if (!session?.selectedTeamId) {
    throw new Error('No team selected');
  }
  
  return await getCustomPackage(packageId, session.selectedTeamId);
}

export const getCustomPackageAction = traceServerAction('getCustomPackageAction', getCustomPackageActionImpl);

/**
 * Server action to get custom package versions
 */
async function getCustomPackageVersionsActionImpl(packageId: string): Promise<CustomPackageVersion[]> {
  const session = await getSessionFromCookies();
  if (!session?.selectedTeamId) {
    throw new Error('No team selected');
  }
  
  return await getCustomPackageVersions(packageId, session.selectedTeamId);
}

export const getCustomPackageVersionsAction = traceServerAction('getCustomPackageVersionsAction', getCustomPackageVersionsActionImpl);

/**
 * Server action to get additional files for a package version
 */
async function getCustomPackageAdditionalFilesActionImpl(versionId: string): Promise<CustomPackageVersionAdditionalFile[]> {
  const session = await getSessionFromCookies();
  if (!session?.selectedTeamId) {
    throw new Error('No team selected');
  }
  
  return await getCustomPackageAdditionalFiles(versionId);
}

export const getCustomPackageAdditionalFilesAction = traceServerAction('getCustomPackageAdditionalFilesAction', getCustomPackageAdditionalFilesActionImpl);

/**
 * Server action to get executions for a custom package
 */
async function getCustomPackageExecutionsActionImpl(packageId: string) {
  const session = await getSessionFromCookies();
  if (!session?.selectedTeamId) {
    throw new Error('No team selected');
  }
  
  return await getCustomPackageExecutions(packageId, session.selectedTeamId);
}

export const getCustomPackageExecutionsAction = traceServerAction('getCustomPackageExecutionsAction', getCustomPackageExecutionsActionImpl);