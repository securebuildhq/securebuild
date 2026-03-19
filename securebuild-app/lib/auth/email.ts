import nodemailer from "nodemailer";
import { getParam } from "@/lib/data/param";
import { logger } from "@/lib/utils/logger";

// In-memory rate limiting: tracks the last send time per email address.
// Resets on server restart - intentional, sufficient for 5-second limit.
const lastSentAt = new Map<string, Date>();

/**
 * Sends an authentication email via SMTP (nodemailer).
 * Throws if SMTP is not configured or if sending fails.
 */
export async function sendAuthEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  const smtpHost = await getParam("SMTP_HOST");
  if (!smtpHost) {
    throw new Error("SMTP is not configured");
  }

  const smtpPort = parseInt(await getParam("SMTP_PORT") || "587");
  const smtpUser = await getParam("SMTP_USER");
  const smtpPassword = await getParam("SMTP_PASSWORD");
  const smtpFrom = await getParam("SMTP_FROM");

  const transporterOptions: nodemailer.TransportOptions & {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  } = {
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
  } as nodemailer.TransportOptions & {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  };

  if (smtpUser) {
    transporterOptions.auth = {
      user: smtpUser,
      pass: smtpPassword,
    };
  }

  const transporter = nodemailer.createTransport(transporterOptions);

  try {
    await transporter.sendMail({
      from: smtpFrom,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    logger.info("Auth email sent", { to: opts.to, subject: opts.subject });
  } catch (err) {
    logger.error("Failed to send auth email", err, { to: opts.to, subject: opts.subject });
    throw err;
  }
}

/**
 * Returns true if at least 5 seconds have passed since the last email was
 * sent to this address. Returns false if it is too soon to send again.
 */
export async function canSendEmailTo(email: string): Promise<boolean> {
  const last = lastSentAt.get(email);
  if (!last) {
    return true;
  }
  const elapsedMs = Date.now() - last.getTime();
  return elapsedMs >= 5000;
}

/**
 * Records that an email was just sent to the given address.
 */
export async function recordEmailSent(email: string): Promise<void> {
  lastSentAt.set(email, new Date());
}
