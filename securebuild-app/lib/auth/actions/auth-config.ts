"use server";

import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import { headers } from "next/headers";

/**
 * Returns the count of rows in buildadmin_user.
 */
export async function countUsers(): Promise<number> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(`SELECT COUNT(1) FROM buildadmin_user`);
    return parseInt(result.rows[0].count, 10);
  } catch {
    // If DB is not available or table does not exist, treat as zero users
    return 0;
  }
}

/**
 * Returns the app origin for use in email links.
 * Uses APP_ORIGIN env var if set, otherwise derives it from the current request's Host header.
 */
export async function getAppOrigin(): Promise<string> {
  const configured = process.env["APP_ORIGIN"] || process.env["NEXT_PUBLIC_APP_ORIGIN"] || "";
  if (configured) return configured;

  const headersList = await headers();
  const host = headersList.get("host") || "localhost:3000";
  const proto = headersList.get("x-forwarded-proto") || "http";
  return `${proto}://${host}`;
}

/**
 * Returns true if SMTP is configured (SMTP_HOST is set).
 */
export async function isSmtpConfigured(): Promise<boolean> {
  return !!process.env["SMTP_HOST"];
}

/**
 * Returns the configured auth method, or "not-configured" if no auth method
 * is set and there are no users in the database.
 */
export async function getAuthMethod(): Promise<string | null> {
  const authMethod = process.env["AUTH_METHOD"] || null;

  if (authMethod) {
    return authMethod;
  }

  // No auth method configured — check if any users exist
  const userCount = await countUsers();
  if (userCount === 0) {
    return "not-configured";
  }

  return null;
}
