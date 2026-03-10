import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { logger } from "../utils/logger";

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  slug: string;
  category: string;
  createdAt: Date;
}

export interface PackageSearchOptions {
  search?: string;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PackageSearchResult {
  packages: CatalogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Search catalog items for documentation purposes
 * This demonstrates the pattern: server actions call library functions, not the DB directly
 */
export async function searchCatalogItems(options: PackageSearchOptions): Promise<PackageSearchResult> {
  const {
    search = '',
    page = 1,
    pageSize = 10,
    sortField = 'name',
    sortOrder = 'asc'
  } = options;

  logger.debug("searching catalog items", { search, page, pageSize, sortField, sortOrder });

  try {
    const db = getDB(await getParam("DB_URI"));

    // Build WHERE clause for search
    let whereClause = 'WHERE is_active = true';
    const params: any[] = [];

    if (search) {
      const searchParamIndex = params.length + 1;
      whereClause += ` AND (
        name ILIKE $${searchParamIndex} OR
        description ILIKE $${searchParamIndex}
      )`;
      params.push(`%${search}%`);
    }

    // First get total count
    const countQuery = `
      SELECT COUNT(*)
      FROM catalog
      ${whereClause}
    `;

    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Build main query with pagination
    let orderByClause = '';
    if (sortField === 'name') {
      orderByClause = `ORDER BY name ${sortOrder.toUpperCase()}`;
    } else if (sortField === 'created_at') {
      orderByClause = `ORDER BY created_at ${sortOrder.toUpperCase()}`;
    } else {
      orderByClause = 'ORDER BY name ASC';
    }

    const offset = (page - 1) * pageSize;
    const limitParamIndex = params.length + 1;
    const offsetParamIndex = params.length + 2;

    const query = `
      SELECT id, name, description, slug, category, created_at
      FROM catalog
      ${whereClause}
      ${orderByClause}
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
    `;

    params.push(pageSize, offset);

    const result = await db.query(query, params);

    const catalogItems: CatalogItem[] = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      slug: row.slug,
      category: row.category,
      createdAt: row.created_at,
    }));

    const totalPages = Math.ceil(total / pageSize);

    return {
      packages: catalogItems,
      total,
      page,
      pageSize,
      totalPages,
    };
  } catch (error) {
    logger.error("Failed to search catalog items", error, { search, page, pageSize });
    throw error;
  }
}

/**
 * Get a single catalog item by slug
 */
export async function getCatalogItemBySlug(slug: string): Promise<CatalogItem | null> {
  logger.debug("getting catalog item by slug", { slug });

  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      SELECT id, name, description, slug, category, created_at
      FROM catalog
      WHERE slug = $1 AND is_active = true
    `;

    const result = await db.query(query, [slug]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      slug: row.slug,
      category: row.category,
      createdAt: row.created_at,
    };
  } catch (error) {
    logger.error("Failed to get catalog item by slug", error, { slug });
    throw error;
  }
}
