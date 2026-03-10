import * as srs from "secure-random-string";
import { getDB, withTransaction } from "../data/db";
import { getParam } from "../data/param";
import Stripe from 'stripe';
import { Subscription, SubscriptionStripeId } from "../types/subscription";
import { getCatalogItemFromSripeProductId, getCustomizedPricing, getCustomizedPricingStripePriceId, getCatalogItems } from "../catalog/catalog";
import { logger } from "../utils/logger";
import { getStripeCustomerId } from "./team";

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16' as Stripe.LatestApiVersion,
    });
  }
  return stripe;
}

export async function createFreeSubscription(catalogItemId: string, teamId: string): Promise<void> {
  const customPrice = await getCustomizedPricing(teamId, catalogItemId);
  if (!customPrice) {
    throw new Error("No custom price found");
  }

  if (customPrice.monthly !== 0) {
    throw new Error("Custom price is not 0");
  }

  const stripePriceId = await getCustomizedPricingStripePriceId(teamId, catalogItemId);
  if (!stripePriceId) {
    throw new Error("No stripe price ID found");
  }

  const customerId = await getStripeCustomerId(teamId);
  if (!customerId) {
    throw new Error("No stripe customer ID found");
  }

  // create the subscription on stripe
  await getStripe().subscriptions.create({
    customer: customerId,
    items: [{ price: stripePriceId }],
  });
}

export async function cancelSubscription(id: string): Promise<boolean> {
  try {
    const db = getDB(await getParam("DB_URI"))
    const query = `select subscription_id from team_subscription where id = $1`;
    const result = await db.query(query, [id]);
    if (result.rows.length === 0) {
      throw new Error("Subscription not found");
    }
    const subscriptionId = result.rows[0].subscription_id;


    await getStripe().subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });

    const query2 = `update team_subscription set is_canceled = true where id = $1`;
    await db.query(query2, [id]);

    return true;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function refreshActiveSubscriptions(teamId: string): Promise<void> {
  logger.debug("Refreshing active subscriptions for team", { teamId });
  const customerId = await getStripeCustomerId(teamId);

  const stripeSubscriptions = await getStripe().subscriptions.list({
    customer: customerId,
    status: 'all',
  });

  const activeSubscriptions = stripeSubscriptions.data.filter(ss => ss.status === 'active');
  const canceledSubscriptions = stripeSubscriptions.data.filter(ss => ss.status === 'canceled');

  const localSubscriptions = await listTeamSubscriptions(teamId);

  for (const subscription of activeSubscriptions) {
    await ensureSubscription(teamId, subscription, localSubscriptions);
  }

  for (const subscription of canceledSubscriptions) {
    await ensureSubscription(teamId, subscription, localSubscriptions);
  }
}

async function ensureSubscription(teamId: string, stripeSubscription: Stripe.Subscription, localSubscriptions: Subscription[]): Promise<void> {
  if (stripeSubscription.status !== 'active' && stripeSubscription.status !== 'canceled') {
    return;
  }

  try {
    const db = getDB(await getParam("DB_URI"));
    await withTransaction(db, async (client) => {
      const localSubscription = localSubscriptions.find(localSubscription => localSubscription.stripeSubscriptionId === stripeSubscription.id);

      if (!stripeSubscription.items.data[0].price.product) {
        console.error("Stripe subscription item has no product");
        return;
      }

      const stripeSubscriptionItem = stripeSubscription.items.data[0];

      const catalogItem = await getCatalogItemFromSripeProductId(stripeSubscriptionItem.price.product as string);

      // Skip processing if catalogItem is null
      if (!catalogItem) {
        console.error("Catalog item not found for product:", stripeSubscriptionItem.price.product);
        return;
      }

      if (localSubscription) {
        // Update existing subscription
        const s = stripeSubscription as any; // Cast to any
        const currentPeriodStart: number = s.current_period_start;
        const currentPeriodEnd: number = s.current_period_end;
        await client.query(
          `
            UPDATE team_subscription
            SET status = $1, recurring_interval = $2, recurring_interval_count = $3, current_period_start = to_timestamp($4), current_period_end = to_timestamp($5), price = $6, catalog_item_id = $7
            WHERE subscription_id = $8
          `,
          [
            stripeSubscription.status,
            stripeSubscriptionItem.price.recurring?.interval || '',
            stripeSubscriptionItem.price.recurring?.interval_count || 0,
            currentPeriodStart,
            currentPeriodEnd,
            stripeSubscriptionItem.price.unit_amount || 0,
            catalogItem.id,
            stripeSubscription.id
          ]
        );
      } else {
        // Insert new subscription
        const s = stripeSubscription as any; // Cast to any
        const created: number = s.created;
        const currentPeriodStart: number = s.current_period_start;
        const currentPeriodEnd: number = s.current_period_end;
        const id = srs.default({ length: 12, alphanumeric: true });
        await client.query(
          `
            INSERT INTO team_subscription (id, subscription_id, team_id, catalog_item_id, status, created_at, recurring_interval, recurring_interval_count, current_period_start, current_period_end, price, is_canceled)
            VALUES ($1, $2, $3, $4, $5, to_timestamp($6), $7, $8, to_timestamp($9), to_timestamp($10), $11, $12)
          `,
          [
            id,
            stripeSubscription.id,
            teamId,
            catalogItem.id,
            stripeSubscription.status,
            created,
            stripeSubscriptionItem.price.recurring?.interval || '',
            stripeSubscriptionItem.price.recurring?.interval_count || 0,
            currentPeriodStart,
            currentPeriodEnd,
            stripeSubscriptionItem.price.unit_amount || 0,
            stripeSubscription.status === 'canceled'
          ]
        );
      }
    });
  } catch (err) {
    console.error(err);
    throw err
  }
}

export async function listTeamSubscriptionsWithStripeIds(teamId: string): Promise<SubscriptionStripeId[]> {
  logger.debug("Listing team subscriptions with stripe ids", { teamId });
  const subscriptions = await listTeamSubscriptions(teamId);
  logger.debug("Subscriptions", { subscriptions });
  const ids: SubscriptionStripeId[] = [];

  try {
    const db = getDB(await getParam("DB_URI"))

    for (const subscription of subscriptions) {
      const result = await db.query(
        `
          SELECT subscription_id FROM team_subscription WHERE id = $1
        `,
        [subscription.id],
      );

      if (result.rows.length > 0) {
        ids.push({
          id: subscription.id,
          stripeSubscriptionId: result.rows[0].subscription_id,
        });
      }
    }

    return ids;
  } catch (err) {
    console.error("Error listing team subscriptions with stripe ids:", err);
    throw err;
  }
}

export async function listTeamSubscriptions(teamId: string): Promise<Subscription[]> {
  logger.debug("Listing team subscriptions", { teamId });
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `
        SELECT
  id, subscription_id, team_id, catalog_item_id, status, created_at, recurring_interval, recurring_interval_count, current_period_start, current_period_end, price, is_canceled
  FROM team_subscription WHERE
  team_id = $1
  AND NOT (is_canceled = true AND current_period_end < NOW())
      `,
      [teamId],
    );

    // Extract unique catalog item IDs from the subscription results
    const catalogItemIds = [...new Set(
      result.rows
        .map(row => row.catalog_item_id)
        .filter(Boolean) // Remove null/undefined values
    )];

    // Bulk fetch all catalog items
    const catalogItemsMap = await getCatalogItems(catalogItemIds);

    // Build the final subscriptions array by reconciling with catalog items
    const subscriptions: Subscription[] = result.rows
      .map((row) => {
        const catalogItem = row.catalog_item_id ? catalogItemsMap.get(row.catalog_item_id) : null;
        
        // Skip subscriptions without catalog items
        if (!catalogItem) {
          return null;
        }

        return {
          id: row.id,
          stripeSubscriptionId: row.subscription_id,
          status: row.status,
          recurringInterval: row.recurring_interval,
          recurringIntervalCount: row.recurring_interval_count,
          price: row.price,
          startedAt: row.created_at,
          currentPeriodStart: row.current_period_start,
          currentPeriodEnd: row.current_period_end,
          isCanceled: row.is_canceled,
          catalogItem: catalogItem,
        };
      })
      .filter(Boolean) as Subscription[]; // Remove null entries

    return subscriptions;
  } catch (err) {
    console.error("Error listing team subscriptions:", err);
    throw err;
  }
}
