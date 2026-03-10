export type NotificationEvent = 'tag_updated' | 'new_tag' | 'cve_found';
export type NotificationType = 'email' | 'webhook';
export type DeliveryStatus = 'delivered' | 'failed' | 'pending' | 'retrying';
export type TagFilterMode = 'all' | 'specific';

export interface TagFilter {
  mode: TagFilterMode;
  tags: string[];
}

export interface Notification {
  id: string;
  teamId: string;
  imageId: string;
  notificationType: NotificationType;
  target: string;
  webhookSecret?: string;
  events: NotificationEvent[];
  tagFilterMode: TagFilterMode;
  tagFilters?: string[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastTriggeredAt?: Date;
  triggerCount: number;
}

export interface NotificationDelivery {
  id: string;
  notificationId: string;
  eventType: NotificationEvent;
  imageName: string;
  imageTag: string;
  imageDigest: string;
  previousDigest?: string;
  payload: string;
  status: DeliveryStatus;
  deliveryAttempts: number;
  maxRetryAttempts: number;
  lastAttemptAt?: Date;
  nextRetryAt?: Date;
  deliveredAt?: Date;
  errorMessage?: string;
  responseCode?: number;
  responseBody?: string;
  manualRetryRequested: boolean;
  manualRetryRequestedAt?: Date;
  manualRetryRequestedBy?: string;
  createdAt: Date;
}

export interface NotificationEventWithDetails {
  id: string;
  notificationId: string;
  eventType: NotificationEvent;
  imageName: string;
  imageTag: string;
  imageDigest: string;
  previousDigest?: string;
  payload: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: Date;
  lastError?: string;
  responseCode?: number;
  responseBody?: string;
  createdAt: Date;
  updatedAt: Date;
  notification: {
    id: string;
    notificationType: NotificationType;
    target: string;
  };
}

export interface CreateNotificationRequest {
  imageIds: string[];
  notificationType: NotificationType;
  target: string;
  webhookSecret?: string;
  events: NotificationEvent[];
  tagFilterMode: TagFilterMode;
  tagFilters?: string[];
}

export interface NotificationWithImage extends Notification {
  image: {
    id: string;
    name: string;
  };
}

export interface NotificationDeliveryWithDetails extends NotificationDelivery {
  notification: {
    id: string;
    notificationType: NotificationType;
    target: string;
  };
}

export interface NotificationDeliveryStats {
  totalDeliveries: number;
  successRate: number;
  failedCount: number;
  pendingRetryingCount: number;
}
