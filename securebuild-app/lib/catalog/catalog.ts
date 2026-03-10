import { getDB, withTransaction } from "../data/db";
import { PoolClient } from "pg";
import { getParam } from "../data/param";
import { CatalogItem, CatalogItemImage } from "../types/catalog";
import * as srs from "secure-random-string";
import Stripe from 'stripe';

export async function setFeaturedCatalogItems(ids: string[]): Promise<void> {
  console.log("Setting featured catalog items:", ids);
  try {
    const db = getDB(await getParam("DB_URI"));
    await withTransaction(db, async (client) => {
      // delete all featured items
      const query = `update catalog set featured_order = null`;
      await client.query(query);

      // set the new featured items
      for (let i = 0; i < ids.length; i++) {
        const query = `update catalog set featured_order = $1 where id = $2`;
        await client.query(query, [i, ids[i]]);
      }
    });
  } catch (error) {
    console.error("Error setting featured catalog items:", error);
    throw error;
  }
}

export async function updateCatalogItem(id: string, name: string, description: string, isActive: boolean, category: string, slug: string, imageUrl: string, isPartner: boolean, isAlternativeBuild: boolean, pricing: { monthly: number, yearly: number }, imageIds: string[]): Promise<CatalogItem> {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }

  const before = await getCatalogItem(id);

  const db = getDB(await getParam("DB_URI"));
  const client = await db.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');

    const query = `update catalog set
name = $1,
description = $2,
is_active = $3,
category = $4,
slug = $5,
image_url = $6,
is_partner = $7,
is_alternative_build = $8,
price_monthly = $9,
price_yearly = $10
where id = $11`;
    await client.query(query, [name, description, isActive, category, slug, imageUrl, isPartner, isAlternativeBuild, pricing.monthly, pricing.yearly, id]);
    
    // Update catalog-image relationships
    // First, delete existing relationships
    const deleteQuery = `delete from catalog_image where catalog_id = $1`;
    await client.query(deleteQuery, [id]);
    
    // Then, insert new relationships
    for (const imageId of imageIds) {
      const insertQuery = `insert into catalog_image (catalog_id, image_id, created_at) values ($1, $2, $3)`;
      await client.query(insertQuery, [id, imageId, new Date()]);
    }
    
    // Check if pricing changed and update Stripe
    // We need to check the pricing directly from the transaction to ensure consistency
    if (pricing.monthly !== before.pricing.monthly || pricing.yearly !== before.pricing.yearly) {
      await updateStripeCatalogItemPricing(client, id, pricing.monthly, pricing.yearly);
    }
    
    // Commit transaction after all operations including Stripe
    await client.query('COMMIT');

    // Return the updated catalog item
    return getCatalogItem(id);
  } catch (error) {
    // Rollback transaction on error
    await client.query('ROLLBACK');
    console.error("Error updating catalog item:", error);
    throw error;
  } finally {
    // Always release the client back to the pool
    client.release();
  }
}

async function updateStripeCatalogItemPricing(client: PoolClient, id: string, monthly: number, yearly: number): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }

  try {
    const query = `select stripe_product_id, stripe_monthly_price_id, stripe_yearly_price_id from catalog where id = $1`;
    const result = await client.query(query, [id]);
    const stripeProductId = result.rows[0].stripe_product_id;
    const stripeMonthlyPriceId = result.rows[0].stripe_monthly_price_id;
    const stripeYearlyPriceId = result.rows[0].stripe_yearly_price_id;

    if (!stripeMonthlyPriceId || !stripeYearlyPriceId) {
      throw new Error("Stripe price ids not found");
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    const stripeMonthlyPrice = await stripe.prices.create({
      product: stripeProductId,
      unit_amount: monthly * 100,
      currency: "usd",
      recurring: {
        interval: "month",
      },
    });

    const stripeYearlyPrice = await stripe.prices.create({
      product: stripeProductId,
      unit_amount: yearly * 100,
      currency: "usd",
      recurring: {
        interval: "year",
      },
    });

    const query2 = `update catalog set stripe_monthly_price_id = $1, stripe_yearly_price_id = $2 where id = $3`;
    await client.query(query2, [stripeMonthlyPrice.id, stripeYearlyPrice.id, id]);
  } catch (error) {
    console.error("Error updating stripe catalog item pricing:", error);
    throw error;
  }
}

export async function createCatalogItem(name: string, description: string, isActive: boolean, category: string, slug: string, imageUrl: string, isPartner: boolean, isAlternativeBuild: boolean, pricing: { monthly: number, yearly: number }, imageIds: string[]): Promise<CatalogItem> {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    const id = srs.default({length: 12, alphanumeric: true});

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const stripeProduct = await stripe.products.create({
      name: name,
      description: description,
      images: [imageUrl],
      shippable: false,
      url: `https://securebuild.com/images/${slug}`,
      metadata: {
        catalog_item_id: id,
      },
    });

    // Create monthly recurring price
    const stripeMonthlyPrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: pricing.monthly * 100,
      currency: "usd",
      recurring: {
        interval: "month",
      },
    });

    // Create yearly recurring price
    const stripeYearlyPrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: pricing.yearly * 100,
      currency: "usd",
      recurring: {
        interval: "year",
      },
    });

    const query = `insert into catalog
(id, name, description, is_active, created_at, category, slug, image_url, is_partner, is_alternative_build, price_monthly, price_yearly, stripe_product_id, stripe_monthly_price_id, stripe_yearly_price_id)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`;
    await db.query(query, [id, name, description, isActive, new Date(), category, slug, imageUrl, isPartner, isAlternativeBuild, pricing.monthly, pricing.yearly, stripeProduct.id, stripeMonthlyPrice.id, stripeYearlyPrice.id]);

    for (const imageId of imageIds) {
      const query = `insert into catalog_image (catalog_id, image_id, created_at) values ($1, $2, $3)`;
      await db.query(query, [id, imageId, new Date()]);
    }

    return getCatalogItem(id);
  } catch (error) {
    console.error("Error creating catalog item:", error);
    throw error;
  }
}

export async function getCatalogItem(id: string): Promise<CatalogItem> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select
  id, name, description, is_active, created_at, category, slug, image_url,
  is_partner, is_alternative_build, price_monthly, price_yearly, stripe_product_id
  from catalog where id = $1`;
    const result = await db.query(query, [id]);

    let catalogItem: CatalogItem = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      description: result.rows[0].description,
      isActive: result.rows[0].is_active,
      createdAt: result.rows[0].created_at,
      category: result.rows[0].category,
      slug: result.rows[0].slug,
      imageUrl: result.rows[0].image_url,
      isPartner: result.rows[0].is_partner,
      isAlternativeBuild: result.rows[0].is_alternative_build,
      pricing: {
        monthly: result.rows[0].price_monthly,
        yearly: result.rows[0].price_yearly,
      },
      stripeProductId: result.rows[0].stripe_product_id,
      images: await listCatalogItemImages(id),
    }

    // if there is not a stripe product id, create one
    if (!catalogItem.stripeProductId) {
      await backfillCatalogItemStripeProductId(id);
      catalogItem = await getCatalogItem(id);
    }

    return catalogItem;
  } catch (error) {
    console.error("Error getting catalog item:", error);
    throw error;
  }
}

async function backfillCatalogItemStripeProductId(id: string): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select name, description, image_url, slug, price_monthly, price_yearly from catalog where id = $1`;
    const result = await db.query(query, [id]);

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const stripeProduct = await stripe.products.create({
      name: result.rows[0].name,
      description: result.rows[0].description,
      images: [result.rows[0].image_url],
      shippable: false,
      url: `https://securebuild.com/images/${result.rows[0].slug}`,
      default_price_data: {
        currency: "usd",
        unit_amount: result.rows[0].price_monthly * 100,
        recurring: {
          interval: "month",
        },
      },
      metadata: {
        catalog_item_id: id,
      },
    });

    // create a price for the yearly plan
    const stripeYearlyPrice = await stripe.prices.create({
      product: stripeProduct.id,
      unit_amount: result.rows[0].price_yearly * 100,
      recurring: {
        interval: "year",
      },
      currency: "usd",
    });

    const query2 = `update catalog set stripe_product_id = $1, stripe_monthly_price_id = $2, stripe_yearly_price_id = $3 where id = $4`;
    await db.query(query2, [stripeProduct.id, stripeProduct.default_price, stripeYearlyPrice.id, id]);
  } catch (error) {
    console.error("Error backfilling catalog item stripe product id:", error);
    throw error;
  }
}

export async function listFeaturedCatalogItems(): Promise<CatalogItem[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select
    id, name, description, is_active, created_at, category, slug, image_url,
    is_partner, is_alternative_build, price_monthly, price_yearly, stripe_product_id
    from catalog
    where featured_order is not null
    order by featured_order`;
    const result = await db.query(query);

    const catalogItems: CatalogItem[] = [];
    for (const row of result.rows) {
      const catalogItem: CatalogItem = {
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        isActive: row.is_active,
        category: row.category,
        slug: row.slug,
        imageUrl: row.image_url,
        isPartner: row.is_partner,
        isAlternativeBuild: row.is_alternative_build,
        pricing: {
          monthly: row.price_monthly,
          yearly: row.price_yearly,
        },
        stripeProductId: row.stripe_product_id,
        images: await listCatalogItemImages(row.id),
      };

      catalogItems.push(catalogItem);
    }

    return catalogItems;
  } catch (error) {
    console.error("Error listing featured catalog items:", error);
    throw error;
  }
}

export async function listCatalogItems(): Promise<CatalogItem[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select
  id, name, description, is_active, created_at, category, slug, image_url,
  is_partner, is_alternative_build, price_monthly, price_yearly, stripe_product_id
  from catalog`;
    const result = await db.query(query);

    const catalogItems: CatalogItem[] = [];
    for (const row of result.rows) {
      const catalogItem: CatalogItem = {
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        isActive: row.is_active,
        category: row.category,
        slug: row.slug,
        imageUrl: row.image_url,
        isPartner: row.is_partner,
        isAlternativeBuild: row.is_alternative_build,
        pricing: {
          monthly: row.price_monthly,
          yearly: row.price_yearly,
        },
        stripeProductId: row.stripe_product_id,
        images: [],
      };
      catalogItems.push(catalogItem);
    }

    for (const catalogItem of catalogItems) {
      const images = await listCatalogItemImages(catalogItem.id);
      catalogItem.images = images;
    }

    return catalogItems;
  } catch (error) {
    console.error("Error listing catalog items:", error);
    throw error;
  }
}

async function listCatalogItemImages(catalogId: string): Promise<CatalogItemImage[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      SELECT DISTINCT
        i.id as image_id,
        i.name as image_name,
        i.created_at as image_created_at,
        i.updated_at as image_updated_at,
        ia.id as apko_id,
        ia.name as apko_name,
        ia.tags as apko_tags,
        ia.last_built_at as apko_last_built_at,
        COALESCE(latest_builds.status, 'no-builds') as build_status,
        latest_builds.created_at as build_created_at
      FROM image i
      INNER JOIN catalog_image ci ON i.id = ci.image_id
      LEFT JOIN image_apko ia ON i.id = ia.image_id
      LEFT JOIN LATERAL (
        SELECT DISTINCT ON (iav.image_apko_id) 
          ib.status, 
          ib.created_at
        FROM image_apko_version iav
        LEFT JOIN image_build ib ON iav.id = ib.image_apko_version_id
        WHERE iav.image_apko_id = ia.id
        ORDER BY iav.image_apko_id, ib.created_at DESC NULLS LAST
      ) latest_builds ON true
      WHERE ci.catalog_id = $1
      ORDER BY i.name, ia.name
    `;
    
    const result = await db.query(query, [catalogId]);

    // Group results by image
    const imageMap = new Map<string, CatalogItemImage>();
    
    for (const row of result.rows) {
      const imageId = row.image_id;
      
      if (!imageMap.has(imageId)) {
        imageMap.set(imageId, {
          imageId: row.image_id,
          name: row.image_name,
          createdAt: row.image_created_at,
          updatedAt: row.image_updated_at,
          apkos: [],
          overallBuildStatus: "no-builds"
        });
      }
      
      const image = imageMap.get(imageId)!;
      
      // Add APKO if it exists
      if (row.apko_id) {
        const buildStatus = row.build_status || "no-builds";
        image.apkos.push({
          id: row.apko_id,
          name: row.apko_name,
          tags: row.apko_tags || [],
          buildStatus: buildStatus as "success" | "failed" | "building" | "pending" | "no-builds",
          lastBuiltAt: row.apko_last_built_at
        });
      }
    }
    
    // Calculate overall build status for each image
    for (const image of imageMap.values()) {
      if (image.apkos.length === 0) {
        image.overallBuildStatus = "no-builds";
      } else {
        const statuses = image.apkos.map(apko => apko.buildStatus);
        if (statuses.some(s => s === "failed")) {
          image.overallBuildStatus = "failed";
        } else if (statuses.some(s => s === "building")) {
          image.overallBuildStatus = "building";
        } else if (statuses.some(s => s === "pending")) {
          image.overallBuildStatus = "pending";
        } else if (statuses.every(s => s === "success")) {
          image.overallBuildStatus = "success";
        } else {
          image.overallBuildStatus = "no-builds";
        }
      }
    }

    return Array.from(imageMap.values());
  } catch (error) {
    console.error("Error listing catalog item images:", error);
    throw error;
  }
}