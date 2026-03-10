import { CatalogItem } from "./catalog";

export interface Subscription {
  id: string;
  stripeSubscriptionId: string;
  status: string;
  recurringInterval: string;
  recurringIntervalCount: number;

  price: number;

  startedAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;

  catalogItem?: CatalogItem;

  isCanceled: boolean;
}


export interface SubscriptionStripeId {
  id: string;
  stripeSubscriptionId: string;
}