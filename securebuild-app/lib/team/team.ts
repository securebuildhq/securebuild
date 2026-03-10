import Stripe from "stripe";
import { getCatalogItem } from "../catalog/catalog";
import { getDB, withTransaction } from "../data/db";
import { getParam } from "../data/param";
import { Team, TeamMember, TeamOverridePricing, TeamSubscription } from "../types/team";
import * as srs from "secure-random-string"

export async function listTeams(): Promise<Team[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(`select id, name, payment_email, created_at, feature_flags from securebuild_team`);
    const teams: Team[] = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      paymentEmail: row.payment_email,
      createdAt: row.created_at,
      featureFlags: row.feature_flags || [],
    }));
    return teams;
  } catch (err) {
    console.error(`listTeams`, err);
    throw err;
  }
}

export async function getTeam(id: string): Promise<Team> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(`select id, name, payment_email, created_at, feature_flags from securebuild_team where id = $1`, [id]);
    const team: Team = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      paymentEmail: result.rows[0].payment_email,
      createdAt: result.rows[0].created_at,
      featureFlags: result.rows[0].feature_flags || [],
    };
    return team;
  } catch (err) {
    console.error(`getTeam`, err);
    throw err;
  }
}

export async function listTeamMembers(id: string): Promise<TeamMember[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const result = await db.query(`select id, email, first_name, last_name, picture, created_at, last_login_at, last_active_at, role from securebuild_user where id in (select user_id from user_team where team_id = $1)`, [id]);
    if (result.rows.length === 0) {
      return [];
    }
    const members: TeamMember[] = result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      picture: row.picture,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      lastActiveAt: row.last_active_at,
      role: row.role,
    }));
    return members;
  } catch (err) {
    console.error(`listTeamMembers`, err);
    throw err;
  }
}

export async function listTeamCatalogSpecialPricing(teamId: string): Promise<TeamOverridePricing[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select tpo.catalog_item_id, tpo.price_monthly, tpo.created_at, tpo.stripe_price_id,
  ci.name, ci.image_url from team_pricing_override tpo, catalog ci where tpo.team_id = $1 and tpo.catalog_item_id = ci.id`;
    const result = await db.query(query, [teamId]);
    const pricing: TeamOverridePricing[] = result.rows.map((row) => ({
      id: row.id,
      catalogItemId: row.catalog_item_id,
      catalogItemName: row.name,
      catalogItemImageUrl: row.image_url,
      priceMonthly: row.price_monthly,
      createdAt: row.created_at,
      stripePriceId: row.stripe_price_id,
    }));
    return pricing;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function removeTeamCatalogSpecialPricing(teamId: string, catalogItemId: string): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await withTransaction(db, async (tx) => {
      await tx.query(`delete from team_pricing_override where team_id = $1 and catalog_item_id = $2`, [teamId, catalogItemId]);
    });
  } catch (err) {
    console.error(`removeTeamCatalogSpecialPricing`, err);
    throw err;
  }
}

export async function setTeamCatalogSpecialPricing(teamId: string, catalogItemId: string, priceMonthly: number): Promise<void> {
  // create a stripe price for the catalog item
  const catalogItem = await getCatalogItem(catalogItemId);
  const stripePriceId = await createCustomStripePrice(catalogItem.stripeProductId, priceMonthly);

  try {
    const db = getDB(await getParam("DB_URI"));
    await withTransaction(db, async (tx) => {
      await tx.query(`delete from team_pricing_override where team_id = $1 and catalog_item_id = $2`, [teamId, catalogItemId]);
      const id = srs.default({ length: 16, alphanumeric: true });
      await tx.query(`insert into team_pricing_override (id, team_id, catalog_item_id, price_monthly, created_at, stripe_price_id) values ($1, $2, $3, $4, now(), $5)`, [id, teamId, catalogItemId, priceMonthly, stripePriceId]);
    });
  } catch (err) {
    console.error(`setTeamCatalogSpecialPricing`, err);
    throw err;
  }
}

async function createCustomStripePrice(productId: string, price: number): Promise<string> {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const stripePrice = await stripe.prices.create({
    product: productId,
    unit_amount: price * 100,
    currency: "usd",
    recurring: {
      interval: "month",
    }

  });
  return stripePrice.id;
}

export async function listTeamSubscriptions(teamId: string): Promise<TeamSubscription[]> {
  try {
    const db = getDB(await getParam("DB_URI"));
    
    const query = `
      SELECT 
        ts.id, 
        ts.subscription_id, 
        ts.team_id, 
        ts.catalog_item_id, 
        ts.status, 
        ts.created_at, 
        ts.recurring_interval, 
        ts.recurring_interval_count, 
        ts.current_period_start, 
        ts.current_period_end, 
        ts.price, 
        ts.is_canceled,
        c.name as catalog_item_name,
        c.image_url as catalog_item_image_url
      FROM team_subscription ts
      LEFT JOIN catalog c ON ts.catalog_item_id = c.id
      WHERE ts.team_id = $1
      AND NOT (ts.is_canceled = true AND ts.current_period_end < NOW())
      ORDER BY ts.created_at DESC
    `;

    const result = await db.query(query, [teamId]);
    
    const subscriptions: TeamSubscription[] = result.rows.map((row) => ({
      id: row.id,
      subscriptionId: row.subscription_id,
      teamId: row.team_id,
      catalogItemId: row.catalog_item_id,
      catalogItemName: row.catalog_item_name || "Unknown Item",
      catalogItemImageUrl: row.catalog_item_image_url || "",
      status: row.status,
      createdAt: row.created_at,
      recurringInterval: row.recurring_interval,
      recurringIntervalCount: row.recurring_interval_count,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      price: row.price,
      isCanceled: row.is_canceled,
    }));

    return subscriptions;
  } catch (err) {
    console.error(`listTeamSubscriptions`, err);
    throw err;
  }
}

export async function getStripeCustomerId(teamId: string): Promise<string> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const result = await db.query(
      `SELECT stripe_customer_id FROM securebuild_team WHERE id = $1`,
      [teamId],
    );

    if (!result.rows[0].stripe_customer_id) {
      return createStripeCustomerId(teamId);
    }

    return result.rows[0].stripe_customer_id;
  } catch (error) {
    console.error("Error getting stripe customer id:", error);
    throw error;
  }
}

async function createStripeCustomerId(teamId: string): Promise<string> {
  const team = await getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    
    // First check if a customer already exists with this email
    const existingCustomers = await stripe.customers.list({ 
      email: team.paymentEmail, 
      limit: 1 
    });
    
    let customerId;
    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
    } else {
      // Create new customer with both email and name
      const customer = await stripe.customers.create({
        email: team.paymentEmail,
        name: team.name,
      });
      customerId = customer.id;
    }

    const db = getDB(await getParam("DB_URI"));
    await db.query(
      `UPDATE securebuild_team SET stripe_customer_id = $1 WHERE id = $2`,
      [customerId, teamId],
    );

    return customerId;
  } catch (error) {
    console.error("Error creating stripe customer id:", error);
    throw error;
  }
}

export async function createFreeSubscription(catalogItemId: string, teamId: string): Promise<void> {
  // Check if subscription already exists for this team and catalog item
  const existingSubscriptions = await listTeamSubscriptions(teamId);
  const existingSubscription = existingSubscriptions.find(
    sub => sub.catalogItemId === catalogItemId && sub.status === 'active' && !sub.isCanceled
  );
  
  if (existingSubscription) {
    throw new Error("An active subscription already exists for this catalog item");
  }

  // Get the custom pricing (should be $0) and its Stripe price ID
  const customPricing = await listTeamCatalogSpecialPricing(teamId);
  const pricing = customPricing.find(p => p.catalogItemId === catalogItemId);
  
  if (!pricing) {
    throw new Error("No custom pricing found for this catalog item");
  }

  if (pricing.priceMonthly !== 0) {
    throw new Error("Custom price is not $0");
  }

  const customerId = await getStripeCustomerId(teamId);
  if (!customerId) {
    throw new Error("No stripe customer ID found");
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    
    // Create the subscription on stripe using the custom pricing's Stripe price ID
    const stripeSubscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: pricing.stripePriceId }],
    });

    console.log("Created Stripe subscription:", stripeSubscription.id);
  } catch (error) {
    console.error("Error creating free subscription:", error);
    throw error;
  }
}

export async function refreshActiveSubscriptions(teamId: string): Promise<void> {
  const customerId = await getStripeCustomerId(teamId);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  const stripeSubscriptions = await stripe.subscriptions.list({
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

async function ensureSubscription(teamId: string, stripeSubscription: any, localSubscriptions: TeamSubscription[]): Promise<void> {
  if (stripeSubscription.status !== 'active' && stripeSubscription.status !== 'canceled') {
    return;
  }

  try {
    const db = getDB(await getParam("DB_URI"));
    await withTransaction(db, async (tx) => {
      const localSubscription = localSubscriptions.find(ls => ls.subscriptionId === stripeSubscription.id);

      if (!stripeSubscription.items.data[0].price.product) {
        console.error("Stripe subscription item has no product");
        return;
      }

      const stripeSubscriptionItem = stripeSubscription.items.data[0];

      // Find catalog item by stripe product ID
      const catalogQuery = `SELECT id FROM catalog WHERE stripe_product_id = $1`;
      const catalogResult = await tx.query(catalogQuery, [stripeSubscriptionItem.price.product]);
      
      if (catalogResult.rows.length === 0) {
        console.error("Catalog item not found for product:", stripeSubscriptionItem.price.product);
        return;
      }

      const catalogItemId = catalogResult.rows[0].id;

      if (localSubscription) {
        // Update existing subscription
        const currentPeriodStart = stripeSubscription.current_period_start;
        const currentPeriodEnd = stripeSubscription.current_period_end;
        
        // Convert timestamps to Date objects or null
        const currentPeriodStartDate = currentPeriodStart ? new Date(currentPeriodStart * 1000) : null;
        const currentPeriodEndDate = currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null;
        
        await tx.query(
          `UPDATE team_subscription
           SET status = $1, recurring_interval = $2, recurring_interval_count = $3, 
               current_period_start = $4, current_period_end = $5, 
               price = $6, catalog_item_id = $7, is_canceled = $8
           WHERE subscription_id = $9`,
          [
            stripeSubscription.status,
            stripeSubscriptionItem.price.recurring?.interval || null,
            stripeSubscriptionItem.price.recurring?.interval_count || null,
            currentPeriodStartDate,
            currentPeriodEndDate,
            stripeSubscriptionItem.price.unit_amount || 0,
            catalogItemId,
            stripeSubscription.status === 'canceled',
            stripeSubscription.id
          ]
        );
      } else {
        // Insert new subscription
        const created = stripeSubscription.created;
        const currentPeriodStart = stripeSubscription.current_period_start;
        const currentPeriodEnd = stripeSubscription.current_period_end;
        const id = srs.default({ length: 12, alphanumeric: true });

        // Stripe timestamps are Unix epoch seconds, so I multiply by 1000 to convert to JavaScript milliseconds
        const currentPeriodStartDate = currentPeriodStart ? new Date(currentPeriodStart * 1000) : null;
        const currentPeriodEndDate = currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null;
        
        await tx.query(
          `INSERT INTO team_subscription (id, subscription_id, team_id, catalog_item_id, status, created_at, 
                                          recurring_interval, recurring_interval_count, current_period_start, 
                                          current_period_end, price, is_canceled)
           VALUES ($1, $2, $3, $4, $5, to_timestamp($6), $7, $8, $9, $10, $11, $12)`,
          [
            id,
            stripeSubscription.id,
            teamId,
            catalogItemId,
            stripeSubscription.status,
            created,
            stripeSubscriptionItem.price.recurring?.interval || null,
            stripeSubscriptionItem.price.recurring?.interval_count || null,
            currentPeriodStartDate,
            currentPeriodEndDate,
            stripeSubscriptionItem.price.unit_amount || 0,
            stripeSubscription.status === 'canceled'
          ]
        );
      }
    });
  } catch (err) {
    console.error("Error ensuring subscription:", err);
    throw err;
  }
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    
    // Cancel the subscription in Stripe
    await stripe.subscriptions.cancel(subscriptionId);
    
    console.log("Canceled Stripe subscription:", subscriptionId);
  } catch (error) {
    console.error("Error canceling subscription:", error);
    throw error;
  }
}

export async function updateTeamFeatureFlags(teamId: string, featureFlags: string[]): Promise<void> {
  try {
    const db = getDB(await getParam("DB_URI"));
    await db.query(`UPDATE securebuild_team SET feature_flags = $1 WHERE id = $2`, [featureFlags, teamId]);
  } catch (err) {
    console.error(`updateTeamFeatureFlags`, err);
    throw err;
  }
}