
export interface Team {
  id: string;
  name: string;
  paymentEmail: string;
  createdAt: Date;
  featureFlags: string[];
}

export interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  picture: string;
  createdAt: Date;
  lastLoginAt: Date;
  lastActiveAt: Date;
  role: "admin" | "developer" | "viewer";
}

export interface TeamOverridePricing {
  id: string;
  catalogItemId: string;
  catalogItemName: string;
  catalogItemImageUrl: string;
  priceMonthly: number;
  createdAt: Date;
  stripePriceId: string;
}

export interface TeamSubscription {
  id: string;
  subscriptionId: string; // Stripe subscription ID
  teamId: string;
  catalogItemId: string;
  catalogItemName: string;
  catalogItemImageUrl: string;
  status: string; // active, canceled, etc.
  createdAt: Date;
  recurringInterval: string | null; // month, year, or null
  recurringIntervalCount: number | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  price: number; // price in cents
  isCanceled: boolean;
}