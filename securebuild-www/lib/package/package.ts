import { getDB } from "../data/db";
import { getParam } from "../data/param";
import { logger } from "../utils/logger";

export interface APKPackage {
  name: string;
  description: string;
  latestVersion: string;
  latestRelease: string;
  license: string;
  maintainer: string;
  homepage: string;
  size: string;
  architectures: string[];
  publishDate: string;
}

export interface PackageRelease {
  version: string;
  release: string;
  publishDate: string;
  architecture: string;
  size: string;
  filename: string;
}

export interface PackageSearchResult {
  packages: APKPackage[];
  total: number;
  page: number;
  pageSize: number;
}

interface PackageSearchOptions {
  search?: string;
  page?: number;
  pageSize?: number;
  sortField?: 'name' | 'version' | 'updated';
  sortOrder?: 'asc' | 'desc';
}

export async function searchPackages(options: PackageSearchOptions): Promise<PackageSearchResult> {
  const {
    search = '',
    page = 1,
    pageSize = 10,
    sortField = 'name',
    sortOrder = 'asc'
  } = options;

  logger.debug("searching packages", { search, page, pageSize, sortField, sortOrder });

  try {
    const db = getDB(await getParam("DB_URI"));



    // Build WHERE clause for search
    let whereClause = 'WHERE is_withdrawn = false';
    const params: any[] = [];

    if (search) {
      const searchParamIndex = params.length + 1;
      whereClause += ` AND (
        (index_content::json ->> 'pkgname') ILIKE $${searchParamIndex} OR
        (index_content::json ->> 'pkgdesc') ILIKE $${searchParamIndex}
      )`;
      params.push(`%${search}%`);
    }

    // First get total count
    const countQuery = `
      SELECT COUNT(DISTINCT (index_content::json ->> 'pkgname'))
      FROM apk_catalog
      ${whereClause}
    `;

    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);

    // Build main query with pagination
    let orderByClause = '';
    switch (sortField) {
      case 'version':
        orderByClause = `ORDER BY
          SUBSTRING(latest_version FROM '^([0-9]+)')::int ${sortOrder} NULLS LAST,
          SUBSTRING(latest_version FROM '^[0-9]+\.([0-9]+)')::int ${sortOrder} NULLS LAST,
          SUBSTRING(latest_version FROM '^[0-9]+\.[0-9]+\.([0-9]+)')::int ${sortOrder} NULLS LAST,
          latest_release::int ${sortOrder} NULLS LAST`;
        break;
      case 'updated':
        // Since we don't have timestamps, sort by version/release instead
        orderByClause = `ORDER BY
          SUBSTRING(latest_version FROM '^([0-9]+)')::int ${sortOrder} NULLS LAST,
          SUBSTRING(latest_version FROM '^[0-9]+\.([0-9]+)')::int ${sortOrder} NULLS LAST,
          SUBSTRING(latest_version FROM '^[0-9]+\.[0-9]+\.([0-9]+)')::int ${sortOrder} NULLS LAST,
          latest_release::int ${sortOrder} NULLS LAST`;
        break;
      case 'name':
      default:
        orderByClause = `ORDER BY package_name ${sortOrder}`;
    }

        const offset = (page - 1) * pageSize;

    // Calculate parameter positions before building query
    const limitParamIndex = params.length + 1;
    const offsetParamIndex = params.length + 2;

    const query = `
      WITH latest_packages AS (
        SELECT DISTINCT ON (index_content::json ->> 'pkgname')
          index_content::json ->> 'pkgname' as package_name,
          index_content::json ->> 'pkgdesc' as description,
          index_content::json ->> 'pkgver' as version,
          COALESCE(index_content::json ->> 'pkgrel', '0') as release,
          index_content::json ->> 'license' as license,
          index_content::json ->> 'maintainer' as maintainer,
          index_content::json ->> 'url' as homepage,
          index_content::json ->> 'size' as size,
          arch,
          filename
        FROM apk_catalog
        ${whereClause}
        ORDER BY
          (index_content::json ->> 'pkgname'),
          SUBSTRING((index_content::json ->> 'pkgver') FROM '^([0-9]+)')::int DESC NULLS LAST,
          SUBSTRING((index_content::json ->> 'pkgver') FROM '^[0-9]+\.([0-9]+)')::int DESC NULLS LAST,
          SUBSTRING((index_content::json ->> 'pkgver') FROM '^[0-9]+\.[0-9]+\.([0-9]+)')::int DESC NULLS LAST,
          COALESCE((index_content::json ->> 'pkgrel')::int, 0) DESC
      ),
      package_summary AS (
        SELECT
          package_name,
          MAX(description) as description,
          MAX(version) as latest_version,
          MAX(release) as latest_release,
          MAX(license) as license,
          MAX(maintainer) as maintainer,
          MAX(homepage) as homepage,
          MAX(size) as size,
          array_agg(DISTINCT arch) as architectures
        FROM latest_packages
        WHERE package_name IS NOT NULL
        GROUP BY package_name
      )
      SELECT * FROM package_summary
      ${orderByClause}
      LIMIT $${limitParamIndex}
      OFFSET $${offsetParamIndex}
    `;

    params.push(pageSize, offset);
    const result = await db.query(query, params);

    const packages: APKPackage[] = result.rows.map(row => ({
      name: row.package_name,
      description: row.description || '',
      latestVersion: row.latest_version || 'unknown',
      latestRelease: row.latest_release || '0',
      license: row.license || 'Unknown',
      maintainer: row.maintainer || 'SecureBuild Team',
      homepage: row.homepage || '',
      size: row.size || '0',
      architectures: row.architectures || [],
      publishDate: new Date().toISOString() // No timestamp available in database
    }));

    return {
      packages,
      total,
      page,
      pageSize
    };
  } catch (error) {
    logger.error('Error searching packages:', error);
    throw error;
  }
}

export async function getPackageReleases(packageName: string): Promise<PackageRelease[]> {
  logger.debug("getting package releases", { packageName });

  try {
    const db = getDB(await getParam("DB_URI"));

    const query = `
      SELECT
        (index_content::json ->> 'pkgver') as version,
        COALESCE(index_content::json ->> 'pkgrel', '0') as release,
        arch as architecture,
        (index_content::json ->> 'size') as size,
        filename
      FROM apk_catalog
      WHERE (index_content::json ->> 'pkgname') = $1
      AND is_withdrawn = false
      ORDER BY
        SUBSTRING((index_content::json ->> 'pkgver') FROM '^([0-9]+)')::int DESC NULLS LAST,
        SUBSTRING((index_content::json ->> 'pkgver') FROM '^[0-9]+\.([0-9]+)')::int DESC NULLS LAST,
        SUBSTRING((index_content::json ->> 'pkgver') FROM '^[0-9]+\.[0-9]+\.([0-9]+)')::int DESC NULLS LAST,
        COALESCE((index_content::json ->> 'pkgrel')::int, 0) DESC,
        arch
    `;

    const result = await db.query(query, [packageName]);

    const releases: PackageRelease[] = result.rows.map(row => ({
      version: row.version || 'unknown',
      release: row.release || '0',
      publishDate: new Date().toISOString(), // No timestamp available in database
      architecture: row.architecture,
      size: row.size || '0',
      filename: row.filename
    }));

    return releases;
  } catch (error) {
    logger.error('Error getting package releases:', error);
    throw error;
  }
}
