import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { logger } from "../utils/logger";
import { NotificationWithImage } from "../types/notification";

import { parseUTCTimestamp } from '../utils/timestamp';

export async function getNotificationWithImage(id: string): Promise<NotificationWithImage | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT
        n.id, n.team_id, n.image_id, n.notification_type, n.target,
        n.webhook_secret, n.events, n.tag_filter_mode, n.tag_filters, n.enabled,
        n.created_at, n.updated_at, n.last_triggered_at, n.trigger_count,
        i.name as image_name
      FROM notification n
      JOIN image i ON i.id = n.image_id
      WHERE n.id = $1
    `;

    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      teamId: row.team_id,
      imageId: row.image_id,
      notificationType: row.notification_type,
      target: row.target,
      webhookSecret: row.webhook_secret,
      events: JSON.parse(row.events),
      tagFilterMode: row.tag_filter_mode,
      tagFilters: row.tag_filters ? JSON.parse(row.tag_filters) : null,
      enabled: row.enabled,
      createdAt: parseUTCTimestamp(row.created_at)!,
      updatedAt: parseUTCTimestamp(row.updated_at)!,
      lastTriggeredAt: parseUTCTimestamp(row.last_triggered_at),
      triggerCount: row.trigger_count,
      image: {
        id: row.image_id,
        name: row.image_name,
      },
    };
  } catch (error) {
    logger.error("Error getting notification with image", error, { id });
    throw error;
  }
}
