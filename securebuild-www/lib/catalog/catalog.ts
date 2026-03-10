import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { CatalogItem, CatalogPricing, Image } from "../types/catalog";
import { logger } from "../utils/logger";
import { parseUTCTimestamp } from "../utils/timestamp";

export async function listFeaturedCatalogItems(): Promise<CatalogItem[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, name, description, created_at, slug, image_url,
  category, price_monthly, price_yearly,
  is_partner, is_alternative_build
  from catalog
  where is_active = true
    and featured_order is not null
  order by featured_order`;
    const result = await db.query(query);

    const catalogItems: CatalogItem[] = [];

    for (const row of result.rows) {
      catalogItems.push({
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        slug: row.slug,
        imageUrl: row.image_url,
        category: row.category,
        images: [],
        isPartner: row.is_partner,
        isAlternativeBuild: row.is_alternative_build,
        pricing: { monthly: row.price_monthly, yearly: row.price_yearly },
        cvesFixedCount: 0,
        tagCount: 0,
        lastBuiltAt: ``,
        license: "Unknown",
      });
    }

    for (const catalogItem of catalogItems) {
      catalogItem.images = await listCatalogItemImages(catalogItem.id);
      catalogItem.cvesFixedCount = await getFixedCVECountForCatalogItem(catalogItem.id);
      catalogItem.lastBuiltAt = await getLastBuiltAtForCatalogItem(catalogItem.id);
      catalogItem.lastScannedAt = await getLastScannedAtForCatalogItem(catalogItem.id);
    }

    return catalogItems;
  } catch (error) {
    console.error("Error listing catalog items:", error);
    throw error;
  }
}

export async function getCatalogItemPriceId(catalogItemId: string, recurringFrequency: string, teamId: string): Promise<string> {
  try {
    const db = getDB(await getParam("DB_URI"));

    let query: string;
    if (recurringFrequency === "monthly") {
      query = `select stripe_monthly_price_id as price_id from catalog where id = $1`;
    } else {
      query = `select stripe_yearly_price_id as price_id from catalog where id = $1`;
    }
    const result = await db.query(query, [catalogItemId]);

    if (result.rows.length === 0) {
      throw new Error("Catalog item price ID not found");
    }

    // look for override pricing
    const overridePricingId = await getCustomizedPricingStripePriceId(teamId, catalogItemId);
    if (overridePricingId) {
      return overridePricingId;
    }

    return result.rows[0].price_id;
  } catch (error) {
    console.error("Error getting catalog item price ID:", error);
    throw error;
  }
}

export async function getCustomizedPricingStripePriceId(teamId: string, catalogItemId: string): Promise<string | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select stripe_price_id from team_pricing_override
where team_id = $1 and catalog_item_id = $2`;
    const result = await db.query(query, [teamId, catalogItemId]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].stripe_price_id;
  } catch (error) {
    console.error("Error getting customized pricing stripe price ID:", error);
    throw error;
  }
}

export async function getCustomizedPricing(teamId: string, catalogItemId: string): Promise<CatalogPricing | null> {
  logger.debug("checking for customized pricing", { teamId, catalogItemId });
  try {
    const db = getDB(await getParam("DB_URI"))
    const query = `select price_monthly from team_pricing_override
where team_id = $1 and catalog_item_id = $2`;
    const result = await db.query(query, [teamId, catalogItemId]);

    if (result.rows.length === 0) {
      return null;
    }

    return {
      monthly: result.rows[0].price_monthly,
      yearly: result.rows[0].price_yearly,
    };
  } catch (error) {
    console.error("Error getting customized pricing:", error);
    throw error;
  }
}

export async function getCatalogItemForImage(imageId: string): Promise<CatalogItem | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select id from catalog where id in (select catalog_id from catalog_image where image_id = $1)`;
    const result = await db.query(query, [imageId]);

    if (result.rows.length === 0) {
      return null;
    }

    return getCatalogItemFromId(result.rows[0].id);
  } catch (error) {
    console.error("Error getting catalog item for image:", error);
    throw error;
  }
}
export async function getCatalogItemFromSripeProductId(productId: string): Promise<CatalogItem | null> {
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select slug from catalog where stripe_product_id = $1`;
    const result = await db.query(query, [productId]);

    if (result.rows.length === 0) {
      return null;
    }

    return getCatalogItem(result.rows[0].slug);
  } catch (error) {
    console.error("Error getting catalog item from stripe product ID:", error);
    throw error;
  }
}

export async function getCatalogItemFromId(id: string): Promise<CatalogItem | null>  {
  logger.debug("getting catalog item from id", { id });
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select slug from catalog where id = $1`;
    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return null
    }

    return getCatalogItem(result.rows[0].slug);
  } catch (error) {
    console.error("Error getting catalog item from ID:", error);
    throw error;
  }
}

/**
 * Bulk version of getCatalogItemFromId that fetches multiple catalog items by IDs directly
 * without the extra slug lookup step
 */
export async function getCatalogItems(catalogItemIds: string[]): Promise<Map<string, CatalogItem>> {
  logger.debug("getting catalog items from ids", { catalogItemIds });
  
  if (catalogItemIds.length === 0) {
    return new Map();
  }

  try {
    const db = getDB(await getParam("DB_URI"));

    // Single query to get all catalog items with their aggregated data
    const query = `
      SELECT DISTINCT
        c.id,
        c.name,
        c.description,
        c.created_at,
        c.slug,
        c.image_url,
        c.category,
        c.price_monthly,
        c.price_yearly,
        c.is_partner,
        c.is_alternative_build,
        COALESCE(cve_data.total_cves, 0) as cves_fixed_count,
        COALESCE(image_data.image_count, 0) as tag_count,
        COALESCE(last_built_data.last_built_at::text, '') as last_built_at,
        COALESCE(last_scanned_data.last_scanned_at::text, '') as last_scanned_at
      FROM catalog c
      LEFT JOIN (
        -- Get CVE counts for each catalog item
        SELECT 
          ci.catalog_id,
          SUM(latest_images.fixed_cve_count_x86) as total_cves
        FROM catalog_image ci
        JOIN (
          SELECT DISTINCT ON (image_id) 
            image_id, 
            fixed_cve_count_x86
          FROM image_catalog
          WHERE is_published = true
          ORDER BY image_id, 
            CASE WHEN tag = 'latest' THEN 0 ELSE 1 END, 
            tag DESC
        ) latest_images ON ci.image_id = latest_images.image_id
        WHERE ci.catalog_id = ANY($1::text[])
        GROUP BY ci.catalog_id
      ) cve_data ON c.id = cve_data.catalog_id
      LEFT JOIN (
        -- Get image count for each catalog item
        SELECT 
          catalog_id,
          COUNT(DISTINCT image_id) as image_count
        FROM catalog_image
        WHERE catalog_id = ANY($1::text[])
        GROUP BY catalog_id
      ) image_data ON c.id = image_data.catalog_id
      LEFT JOIN (
        -- Get last built timestamp for each catalog item
        SELECT 
          ci.catalog_id,
          MAX(ic.updated_at) as last_built_at
        FROM catalog_image ci
        JOIN image_catalog ic ON ci.image_id = ic.image_id
        WHERE ic.is_published = true AND ci.catalog_id = ANY($1::text[])
        GROUP BY ci.catalog_id
      ) last_built_data ON c.id = last_built_data.catalog_id
      LEFT JOIN (
        -- Get last scanned timestamp for each catalog item
        SELECT 
          ci.catalog_id,
          MAX(ic.last_scanned_at) as last_scanned_at
        FROM catalog_image ci
        JOIN image_catalog ic ON ci.image_id = ic.image_id
        WHERE ic.is_published = true AND ic.last_scanned_at IS NOT NULL AND ci.catalog_id = ANY($1::text[])
        GROUP BY ci.catalog_id
      ) last_scanned_data ON c.id = last_scanned_data.catalog_id
      WHERE c.id = ANY($1::text[])
      ORDER BY c.name;
    `;
    
    const result = await db.query(query, [catalogItemIds]);

    // Fetch images for all catalog items in bulk
    const imagesMap = await listCatalogItemImagesBulk(catalogItemIds);

    // Build the catalog items map
    const catalogItemsMap = new Map<string, CatalogItem>();

    for (const row of result.rows) {
      const catalogItem: CatalogItem = {
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        slug: row.slug,
        imageUrl: row.image_url,
        category: row.category,
        images: imagesMap.get(row.id) || [],
        isPartner: row.is_partner,
        isAlternativeBuild: row.is_alternative_build,
        pricing: {
          monthly: row.price_monthly,
          yearly: row.price_yearly,
        },
        cvesFixedCount: row.cves_fixed_count || 0,
        tagCount: row.tag_count || 0,
        lastBuiltAt: safeISOTimestamp(row.last_built_at),
        lastScannedAt: safeISOTimestamp(row.last_scanned_at),
        license: "Unknown",
      };
      
      catalogItemsMap.set(row.id, catalogItem);
    }

    return catalogItemsMap;
  } catch (error) {
    console.error("Error getting catalog items from IDs:", error);
    throw error;
  }
}

export async function getCatalogItem(slug: string): Promise<CatalogItem | null> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `select id, name, description, created_at, slug,
image_url, category, price_monthly, price_yearly,
is_partner, is_alternative_build
from catalog where slug = $1`;
    const result = await db.query(query, [slug]);

    if (result.rows.length === 0) {
      return null;
    }

    const catalogItem: CatalogItem = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      description: result.rows[0].description,
      createdAt: result.rows[0].created_at,
      slug: result.rows[0].slug,
      imageUrl: result.rows[0].image_url,
      category: result.rows[0].category,
      images: [],
      isPartner: result.rows[0].is_partner,
      isAlternativeBuild: result.rows[0].is_alternative_build,
      pricing: {
        monthly: result.rows[0].price_monthly,
        yearly: result.rows[0].price_yearly,
      },
      cvesFixedCount: 0,
      tagCount: 0,
      lastBuiltAt: ``,
      lastScannedAt: ``,
      license: "Unknown",
    };

    catalogItem.images = await listCatalogItemImages(catalogItem.id);
    catalogItem.cvesFixedCount = await getFixedCVECountForCatalogItem(result.rows[0].id);
    catalogItem.lastBuiltAt = await getLastBuiltAtForCatalogItem(catalogItem.id);
    catalogItem.lastScannedAt = await getLastScannedAtForCatalogItem(catalogItem.id);

    return catalogItem;
  } catch (error) {
    console.error("Error getting catalog item:", error);
    throw error;
  }
}

async function getFixedCVECountForCatalogItem(id: string): Promise<number> {
  logger.debug("getting fixed cve count for catalog item", { id });
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select fixed_cve_count_x86 from (
      select distinct on (image_id) * from image_catalog
      where is_published = true and image_id in (select image_id from catalog_image where catalog_id = $1)
      order by image_id, case when tag = 'latest' then 0 else 1 end, tag desc
    ) as t`;

    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return 0;
    }

    let total: number = 0;
    for (const row of result.rows) {
      total += row.fixed_cve_count_x86;
    }

    return total;
  } catch (error) {
    console.error("Error getting fixed CVE count for catalog item:", error);
    throw error;
  }
};

function safeISOTimestamp(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = parseUTCTimestamp(raw);
  return (d && !isNaN(d.getTime())) ? d.toISOString() : '';
}

async function getLastBuiltAtForCatalogItem(id: string): Promise<string> {
  logger.debug("getting last built at for catalog item", { id });
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select updated_at::text as updated_at from image_catalog
      where is_published = true and image_id in (select image_id from catalog_image where catalog_id = $1)
      order by updated_at desc limit 1`;

    const result = await db.query(query, [id]);

    if (result.rows.length === 0 || !result.rows[0].updated_at) {
      return "";
    }

    const parsedDate = parseUTCTimestamp(result.rows[0].updated_at);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      logger.warn(`Invalid timestamp value for catalog item ${id}: ${result.rows[0].updated_at}`);
      return "";
    }
    return parsedDate.toISOString();
  } catch (err) {
    console.error("Error getting last built at for catalog item:", err);
    throw err;
  }
}

async function getLastScannedAtForCatalogItem(id: string): Promise<string> {
  logger.debug("getting last scanned at for catalog item", { id });
  try {
    const db = getDB(await getParam("DB_URI"));
    const query = `select last_scanned_at::text as last_scanned_at from image_catalog
      where is_published = true and image_id in (select image_id from catalog_image where catalog_id = $1)
      and last_scanned_at is not null
      order by last_scanned_at desc limit 1`;

    const result = await db.query(query, [id]);

    if (result.rows.length === 0 || !result.rows[0].last_scanned_at) {
      return "";
    }

    const parsedDate = parseUTCTimestamp(result.rows[0].last_scanned_at);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      logger.warn(`Invalid timestamp value for catalog item ${id}: ${result.rows[0].last_scanned_at}`);
      return "";
    }
    return parsedDate.toISOString();
  } catch (err) {
    console.error("Error getting last scanned at for catalog item:", err);
    throw err;
  }
}

export async function listCatalogItems(): Promise<CatalogItem[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    // Optimized query that fetches all catalog data in a single query using JOINs
    const query = `
      SELECT DISTINCT
        c.id,
        c.name,
        c.description,
        c.created_at,
        c.slug,
        c.image_url,
        c.category,
        c.price_monthly,
        c.price_yearly,
        c.is_partner,
        c.is_alternative_build,
        COALESCE(cve_data.total_cves, 0) as cves_fixed_count,
        COALESCE(image_data.image_count, 0) as tag_count,
        COALESCE(last_built_data.last_built_at::text, '') as last_built_at,
        COALESCE(last_scanned_data.last_scanned_at::text, '') as last_scanned_at
      FROM catalog c
      LEFT JOIN (
        -- Get CVE counts for each catalog item
        SELECT 
          ci.catalog_id,
          SUM(latest_images.fixed_cve_count_x86) as total_cves
        FROM catalog_image ci
        JOIN (
          SELECT DISTINCT ON (image_id) 
            image_id, 
            fixed_cve_count_x86
          FROM image_catalog
          WHERE is_published = true
          ORDER BY image_id, 
            CASE WHEN tag = 'latest' THEN 0 ELSE 1 END, 
            tag DESC
        ) latest_images ON ci.image_id = latest_images.image_id
        GROUP BY ci.catalog_id
      ) cve_data ON c.id = cve_data.catalog_id
      LEFT JOIN (
        -- Get image count for each catalog item
        SELECT 
          catalog_id,
          COUNT(DISTINCT image_id) as image_count
        FROM catalog_image
        GROUP BY catalog_id
      ) image_data ON c.id = image_data.catalog_id
      LEFT JOIN (
        -- Get last built timestamp for each catalog item
        SELECT 
          ci.catalog_id,
          MAX(ic.updated_at) as last_built_at
        FROM catalog_image ci
        JOIN image_catalog ic ON ci.image_id = ic.image_id
        WHERE ic.is_published = true
        GROUP BY ci.catalog_id
      ) last_built_data ON c.id = last_built_data.catalog_id
      LEFT JOIN (
        -- Get last scanned timestamp for each catalog item
        SELECT 
          ci.catalog_id,
          MAX(ic.last_scanned_at) as last_scanned_at
        FROM catalog_image ci
        JOIN image_catalog ic ON ci.image_id = ic.image_id
        WHERE ic.is_published = true AND ic.last_scanned_at IS NOT NULL
        GROUP BY ci.catalog_id
      ) last_scanned_data ON c.id = last_scanned_data.catalog_id
      WHERE c.is_active = true
      ORDER BY c.name;
    `;
    
    const result = await db.query(query);

    const catalogItems: CatalogItem[] = [];

    for (const row of result.rows) {
      catalogItems.push({
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        slug: row.slug,
        imageUrl: row.image_url,
        category: row.category,
        images: [],
        isPartner: row.is_partner,
        isAlternativeBuild: row.is_alternative_build,
        pricing: { monthly: row.price_monthly, yearly: row.price_yearly },
        cvesFixedCount: row.cves_fixed_count || 0,
        tagCount: row.tag_count || 0,
        lastBuiltAt: safeISOTimestamp(row.last_built_at),
        lastScannedAt: safeISOTimestamp(row.last_scanned_at),
        license: "Unknown",
      });
    }

    // Now fetch images for all catalog items in bulk
    const catalogItemIds = catalogItems.map(item => item.id);
    if (catalogItemIds.length > 0) {
      const imagesMap = await listCatalogItemImagesBulk(catalogItemIds);
      
      // Assign images to each catalog item
      for (const catalogItem of catalogItems) {
        catalogItem.images = imagesMap.get(catalogItem.id) || [];
      }
    }

    return catalogItems;
  } catch (error) {
    console.error("Error listing catalog items:", error);
    throw error;
  }
}

async function listCatalogItemImages(catalogItemId: string): Promise<Image[]> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      select id, name, created_at, updated_at from image where id in (select image_id from catalog_image where catalog_id = $1)
    `;

    const catalogImages: Image[] = [];

    const result = await db.query(query, [catalogItemId]);

    for (const row of result.rows) {
      const catalogImage: Image = {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      catalogImages.push(catalogImage);
    }

    return catalogImages;
  } catch (error) {
    console.error("Error listing catalog item images:", error);
    throw error;
  }
}

/**
 * Bulk version of listCatalogItemImages that fetches images for multiple catalog items at once
 */
export async function listCatalogItemImagesBulk(catalogItemIds: string[]): Promise<Map<string, Image[]>> {
  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      SELECT 
        ci.catalog_id,
        i.id,
        i.name,
        i.created_at,
        i.updated_at
      FROM catalog_image ci
      JOIN image i ON ci.image_id = i.id
      WHERE ci.catalog_id = ANY($1::text[])
      ORDER BY ci.catalog_id, i.name
    `;

    const result = await db.query(query, [catalogItemIds]);
    
    // Group images by catalog_id
    const imagesMap = new Map<string, Image[]>();
    
    for (const row of result.rows) {
      const catalogId = row.catalog_id;
      const image: Image = {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      
      if (!imagesMap.has(catalogId)) {
        imagesMap.set(catalogId, []);
      }
      imagesMap.get(catalogId)!.push(image);
    }

    return imagesMap;
  } catch (error) {
    console.error("Error listing catalog item images in bulk:", error);
    throw error;
  }
}
