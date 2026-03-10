import { getDB, withTransaction } from "../data/db";
import { getParam } from "../data/param";
import { logger } from "../utils/logger";
import { parseUTCTimestamp } from "../utils/timestamp";
import * as srs from "secure-random-string";
import {
  Notification,
  NotificationDelivery,
  CreateNotificationRequest,
  NotificationWithImage,
  NotificationDeliveryWithDetails,
  NotificationEvent,
  DeliveryStatus,
  NotificationEventWithDetails,
} from "../types/notification";

// Helper function to create UTC timestamp for database
function getUTCTimestamp(): string {
  return new Date().toISOString();
}

export async function createNotification(
  teamId: string,
  request: CreateNotificationRequest
): Promise<Notification[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const notifications: Notification[] = [];

    await withTransaction(db, async (client) => {
      // Create a notification for each image
      for (const imageId of request.imageIds) {
        const id = srs.default({ length: 24, alphanumeric: true });
        const now = getUTCTimestamp(); // Use ISO string for UTC

        const query = `
          INSERT INTO notification (
            id, team_id, image_id, notification_type, target, webhook_secret,
            events, tag_filter_mode, tag_filters, enabled, created_at, updated_at,
            last_triggered_at, trigger_count
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `;

        await client.query(query, [
          id,
          teamId,
          imageId,
          request.notificationType,
          request.target,
          request.webhookSecret || null,
          JSON.stringify(request.events),
          request.tagFilterMode,
          request.tagFilters ? JSON.stringify(request.tagFilters) : null,
          true, // enabled by default
          now,
          now,
          null, // last_triggered_at
          0, // trigger_count
        ]);

        const notification: Notification = {
          id,
          teamId,
          imageId,
          notificationType: request.notificationType,
          target: request.target,
          webhookSecret: request.webhookSecret,
          events: request.events,
          tagFilterMode: request.tagFilterMode,
          tagFilters: request.tagFilters,
          enabled: true,
          createdAt: new Date(now),
          updatedAt: new Date(now),
          lastTriggeredAt: undefined,
          triggerCount: 0,
        };

        notifications.push(notification);
      }
    });

    logger.info("Created notifications", {
      teamId,
      count: notifications.length,
      notificationType: request.notificationType,
    });

    return notifications;
  } catch (error) {
    logger.error("Error creating notifications", error, { teamId, request });
    throw error;
  }
}

export async function listNotifications(teamId: string): Promise<NotificationWithImage[]> {
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
      WHERE n.team_id = $1
      ORDER BY n.created_at DESC
    `;

    const result = await db.query(query, [teamId]);

    return result.rows.map((row) => ({
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
    }));
  } catch (error) {
    logger.error("Error listing notifications", error, { teamId });
    throw error;
  }
}

export async function getNotification(id: string): Promise<Notification | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT
        id, team_id, image_id, notification_type, target, webhook_secret,
        events, tag_filter_mode, tag_filters, enabled, created_at, updated_at,
        last_triggered_at, trigger_count
      FROM notification
      WHERE id = $1
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
    };
  } catch (error) {
    logger.error("Error getting notification", error, { id });
    throw error;
  }
}

export async function getNotificationWithCatalogItem(id: string): Promise<NotificationWithImage | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT
        n.id, n.team_id, n.catalog_item_id, n.notification_type, n.target,
        n.webhook_secret, n.events, n.tag_filter_mode, n.tag_filters, n.enabled,
        n.created_at, n.updated_at, n.last_triggered_at, n.trigger_count,
        c.name as catalog_name, c.slug as catalog_slug
      FROM notification n
      JOIN catalog c ON c.id = n.catalog_item_id
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
      imageId: row.catalog_item_id,
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
        id: row.catalog_item_id,
        name: row.catalog_name,
      },
    };
  } catch (error) {
    logger.error("Error getting notification with catalog item", error, { id });
    throw error;
  }
}

export async function updateNotificationEnabled(
  id: string,
  enabled: boolean
): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const now = getUTCTimestamp(); // Use ISO string for UTC
    const query = `
      UPDATE notification
      SET enabled = $1, updated_at = $2
      WHERE id = $3
    `;

    await db.query(query, [enabled, now, id]);

    logger.info("Updated notification enabled status", { id, enabled });
  } catch (error) {
    logger.error("Error updating notification enabled status", error, { id, enabled });
    throw error;
  }
}

export async function updateNotification(
  id: string,
  updates: {
    target?: string;
    webhookSecret?: string;
    events?: NotificationEvent[];
    tagFilterMode?: string;
    tagFilters?: string[];
  }
): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.target !== undefined) {
      updateFields.push(`target = $${paramIndex}`);
      params.push(updates.target);
      paramIndex++;
    }

    if (updates.webhookSecret !== undefined) {
      updateFields.push(`webhook_secret = $${paramIndex}`);
      params.push(updates.webhookSecret || null);
      paramIndex++;
    }

    if (updates.events !== undefined) {
      updateFields.push(`events = $${paramIndex}`);
      params.push(JSON.stringify(updates.events));
      paramIndex++;
    }

    if (updates.tagFilterMode !== undefined) {
      updateFields.push(`tag_filter_mode = $${paramIndex}`);
      params.push(updates.tagFilterMode);
      paramIndex++;
    }

    if (updates.tagFilters !== undefined) {
      updateFields.push(`tag_filters = $${paramIndex}`);
      params.push(updates.tagFilters ? JSON.stringify(updates.tagFilters) : null);
      paramIndex++;
    }

    if (updateFields.length === 0) {
      throw new Error("No fields to update");
    }

    const now = getUTCTimestamp(); // Use ISO string for UTC
    updateFields.push(`updated_at = $${paramIndex}`);
    params.push(now);
    paramIndex++;
    params.push(id);

    const query = `
      UPDATE notification
      SET ${updateFields.join(", ")}
      WHERE id = $${paramIndex}
    `;

    await db.query(query, params);

    logger.info("Updated notification", { id, updates });
  } catch (error) {
    logger.error("Error updating notification", error, { id, updates });
    throw error;
  }
}

export async function deleteNotification(id: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));

    await withTransaction(db, async (client) => {
      // Delete notification deliveries first (cascade should handle this, but being explicit)
      await client.query("DELETE FROM notification_delivery WHERE notification_id = $1", [id]);

      // Delete the notification
      await client.query("DELETE FROM notification WHERE id = $1", [id]);
    });

    logger.info("Deleted notification", { id });
  } catch (error) {
    logger.error("Error deleting notification", error, { id });
    throw error;
  }
}

export async function listNotificationDeliveries(
  teamId: string,
  options?: {
    limit?: number;
    offset?: number;
    status?: DeliveryStatus;
    imageName?: string;
    since?: Date;
  }
): Promise<NotificationDeliveryWithDetails[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    let query = `
      SELECT
        nd.id, nd.notification_id, nd.event_type, nd.image_name, nd.image_tag,
        nd.image_digest, nd.previous_digest, nd.payload, nd.status,
        nd.delivery_attempts, nd.max_retry_attempts, nd.last_attempt_at,
        nd.next_retry_at, nd.delivered_at, nd.error_message, nd.response_code,
        nd.response_body, nd.manual_retry_requested, nd.manual_retry_requested_at,
        nd.manual_retry_requested_by, nd.created_at,
        n.notification_type, n.target
      FROM notification_delivery nd
      JOIN notification n ON n.id = nd.notification_id
      WHERE n.team_id = $1
    `;

    const params: any[] = [teamId];
    let paramIndex = 2;

    if (options?.status) {
      query += ` AND nd.status = $${paramIndex}`;
      params.push(options.status);
      paramIndex++;
    }

    if (options?.imageName) {
      query += ` AND nd.image_name = $${paramIndex}`;
      params.push(options.imageName);
      paramIndex++;
    }

    if (options?.since) {
      query += ` AND nd.created_at >= $${paramIndex}`;
      params.push(options.since);
      paramIndex++;
    }

    query += ` ORDER BY nd.created_at DESC`;

    if (options?.limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(options.limit);
      paramIndex++;
    }

    if (options?.offset) {
      query += ` OFFSET $${paramIndex}`;
      params.push(options.offset);
    }

    const result = await db.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      notificationId: row.notification_id,
      eventType: row.event_type,
      imageName: row.image_name,
      imageTag: row.image_tag,
      imageDigest: row.image_digest,
      previousDigest: row.previous_digest,
      payload: row.payload,
      status: row.status,
      deliveryAttempts: row.delivery_attempts,
      maxRetryAttempts: row.max_retry_attempts,
      lastAttemptAt: parseUTCTimestamp(row.last_attempt_at),
      nextRetryAt: parseUTCTimestamp(row.next_retry_at),
      deliveredAt: parseUTCTimestamp(row.delivered_at),
      errorMessage: row.error_message,
      responseCode: row.response_code,
      responseBody: row.response_body,
      manualRetryRequested: row.manual_retry_requested,
      manualRetryRequestedAt: parseUTCTimestamp(row.manual_retry_requested_at),
      manualRetryRequestedBy: row.manual_retry_requested_by,
      createdAt: parseUTCTimestamp(row.created_at)!,
      notification: {
        id: row.notification_id,
        notificationType: row.notification_type,
        target: row.target,
      },
    }));
  } catch (error) {
    logger.error("Error listing notification deliveries", error, { teamId, options });
    throw error;
  }
}

export async function getNotificationDelivery(id: string): Promise<NotificationDelivery | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `
      SELECT
        id, notification_id, event_type, image_name, image_tag, image_digest,
        previous_digest, payload, status, delivery_attempts, max_retry_attempts,
        last_attempt_at, next_retry_at, delivered_at, error_message, response_code,
        response_body, manual_retry_requested, manual_retry_requested_at,
        manual_retry_requested_by, created_at
      FROM notification_delivery
      WHERE id = $1
    `;

    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      notificationId: row.notification_id,
      eventType: row.event_type,
      imageName: row.image_name,
      imageTag: row.image_tag,
      imageDigest: row.image_digest,
      previousDigest: row.previous_digest,
      payload: row.payload,
      status: row.status,
      deliveryAttempts: row.delivery_attempts,
      maxRetryAttempts: row.max_retry_attempts,
      lastAttemptAt: parseUTCTimestamp(row.last_attempt_at),
      nextRetryAt: parseUTCTimestamp(row.next_retry_at),
      deliveredAt: parseUTCTimestamp(row.delivered_at),
      errorMessage: row.error_message,
      responseCode: row.response_code,
      responseBody: row.response_body,
      manualRetryRequested: row.manual_retry_requested,
      manualRetryRequestedAt: parseUTCTimestamp(row.manual_retry_requested_at),
      manualRetryRequestedBy: row.manual_retry_requested_by,
      createdAt: parseUTCTimestamp(row.created_at)!,
    };
  } catch (error) {
    logger.error("Error getting notification delivery", error, { id });
    throw error;
  }
}

export async function retryNotificationDelivery(
  deliveryId: string,
  userId: string
): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const now = getUTCTimestamp(); // Use ISO string for UTC
    const query = `
      UPDATE notification_delivery
      SET manual_retry_requested = true,
          manual_retry_requested_at = $1,
          manual_retry_requested_by = $2,
          next_retry_at = $3
      WHERE id = $4
    `;

    await db.query(query, [now, userId, now, deliveryId]);

    logger.info("Marked notification delivery for manual retry", { deliveryId, userId });
  } catch (error) {
    logger.error("Error marking notification delivery for retry", error, { deliveryId, userId });
    throw error;
  }
}

export async function getNotificationDeliveryStats(
  teamId: string,
  since?: Date
): Promise<{
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  pendingDeliveries: number;
  successRate: number;
}> {
  try {
    const db = getDB(await getParam("DB_URI"));

    let query = `
      SELECT
        COUNT(*) as total_deliveries,
        COUNT(CASE WHEN nd.status = 'delivered' THEN 1 END) as successful_deliveries,
        COUNT(CASE WHEN nd.status = 'failed' THEN 1 END) as failed_deliveries,
        COUNT(CASE WHEN nd.status IN ('pending', 'retrying') THEN 1 END) as pending_deliveries
      FROM notification_delivery nd
      JOIN notification n ON n.id = nd.notification_id
      WHERE n.team_id = $1
    `;

    const params: any[] = [teamId];

    if (since) {
      query += ` AND nd.created_at >= $2`;
      params.push(since);
    }

    const result = await db.query(query, params);
    const row = result.rows[0];

    const totalDeliveries = parseInt(row.total_deliveries);
    const successfulDeliveries = parseInt(row.successful_deliveries);
    const failedDeliveries = parseInt(row.failed_deliveries);
    const pendingDeliveries = parseInt(row.pending_deliveries);

    // Calculate success rate excluding pending deliveries
    // Success rate = successful / (successful + failed)
    const processedDeliveries = successfulDeliveries + failedDeliveries;
    const successRate = processedDeliveries > 0 ? (successfulDeliveries / processedDeliveries) * 100 : 0;

    return {
      totalDeliveries,
      successfulDeliveries,
      failedDeliveries,
      pendingDeliveries,
      successRate,
    };
  } catch (error) {
    logger.error("Error getting notification delivery stats", error, { teamId, since });
    throw error;
  }
}

export async function listNotificationEvents(
  teamId: string,
  options?: {
    limit?: number;
    offset?: number;
    status?: string;
    imageName?: string;
    since?: Date;
  }
): Promise<NotificationEventWithDetails[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    let query = `
      SELECT
        ne.id, ne.notification_id, ne.event_type, ne.image_name, ne.image_tag,
        ne.image_digest, ne.previous_digest, ne.payload, ne.status,
        ne.attempts, ne.max_attempts, ne.next_retry_at, ne.last_error,
        ne.response_code, ne.response_body, ne.created_at, ne.updated_at,
        n.notification_type, n.target
      FROM notification_event ne
      JOIN notification n ON n.id = ne.notification_id
      WHERE n.team_id = $1
    `;

    const params: any[] = [teamId];
    let paramIndex = 2;

    if (options?.status) {
      query += ` AND ne.status = $${paramIndex}`;
      params.push(options.status);
      paramIndex++;
    }

    if (options?.imageName) {
      query += ` AND ne.image_name = $${paramIndex}`;
      params.push(options.imageName);
      paramIndex++;
    }

    if (options?.since) {
      query += ` AND ne.created_at >= $${paramIndex}`;
      params.push(options.since);
      paramIndex++;
    }

    query += ` ORDER BY ne.created_at DESC`;

    if (options?.limit) {
      query += ` LIMIT $${paramIndex}`;
      params.push(options.limit);
      paramIndex++;
    }

    if (options?.offset) {
      query += ` OFFSET $${paramIndex}`;
      params.push(options.offset);
    }

    const result = await db.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      notificationId: row.notification_id,
      eventType: row.event_type,
      imageName: row.image_name,
      imageTag: row.image_tag,
      imageDigest: row.image_digest,
      previousDigest: row.previous_digest,
      payload: row.payload,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      nextRetryAt: parseUTCTimestamp(row.next_retry_at),
      lastError: row.last_error,
      responseCode: row.response_code,
      responseBody: row.response_body,
      createdAt: parseUTCTimestamp(row.created_at)!,
      updatedAt: parseUTCTimestamp(row.updated_at)!,
      notification: {
        id: row.notification_id,
        notificationType: row.notification_type,
        target: row.target,
      },
    }));
  } catch (error) {
    logger.error("Error listing notification events", error, { teamId, options });
    throw error;
  }
}

export async function getNotificationEventStats(
  teamId: string,
  since?: Date
): Promise<{
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  pendingEvents: number;
  successRate: number;
}> {
  try {
    const db = getDB(await getParam("DB_URI"));

    let query = `
      SELECT
        COUNT(*) as total_events,
        COUNT(CASE WHEN ne.status = 'delivered' THEN 1 END) as successful_events,
        COUNT(CASE WHEN ne.status = 'failed' THEN 1 END) as failed_events,
        COUNT(CASE WHEN ne.status IN ('pending', 'processing') THEN 1 END) as pending_events
      FROM notification_event ne
      JOIN notification n ON n.id = ne.notification_id
      WHERE n.team_id = $1
    `;

    const params: any[] = [teamId];

    if (since) {
      query += ` AND ne.created_at >= $2`;
      params.push(since);
    }

    const result = await db.query(query, params);
    const row = result.rows[0];

    const totalEvents = parseInt(row.total_events);
    const successfulEvents = parseInt(row.successful_events);
    const failedEvents = parseInt(row.failed_events);
    const pendingEvents = parseInt(row.pending_events);

    // Calculate success rate excluding pending events
    // Success rate = successful / (successful + failed)
    const processedEvents = successfulEvents + failedEvents;
    const successRate = processedEvents > 0 ? (successfulEvents / processedEvents) * 100 : 0;

    return {
      totalEvents,
      successfulEvents,
      failedEvents,
      pendingEvents,
      successRate,
    };
  } catch (error) {
    logger.error("Error getting notification event stats", error, { teamId, since });
    throw error;
  }
}

export async function retryNotificationEvent(
  eventId: string,
  userId: string
): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const now = getUTCTimestamp(); // Use ISO string for UTC
    const query = `
      UPDATE notification_event
      SET status = 'pending',
          next_retry_at = $1,
          updated_at = $2
      WHERE id = $3
    `;

    await db.query(query, [now, now, eventId]);

    logger.info("Reset notification event for retry", { eventId, userId });
  } catch (error) {
    logger.error("Error resetting notification event for retry", error, { eventId, userId });
    throw error;
  }
}
