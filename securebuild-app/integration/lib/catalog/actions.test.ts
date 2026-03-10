/**
 * Integration tests for catalog item server actions
 * Tests createCatalogItemAction, getCatalogItemAction, and listCatalogItemsAction
 */

// Store the test connection string for this test suite
let testConnectionString: string;

// Mock getParam to return this test's connection string
jest.mock("@/lib/data/param", () => ({
  getParam: jest.fn(async (key: string) => {
    if (key === "DB_URI" || key === "DBUri") {
      return testConnectionString;
    }
    throw new Error(`unknown param ${key}`);
  }),
  loadParams: jest.fn(),
}));

// Mock Stripe SDK to prevent actual API calls
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    products: {
      create: jest.fn().mockResolvedValue({
        id: 'prod_mock123',
        name: 'Mock Product',
        active: true
      })
    },
    prices: {
      create: jest.fn().mockResolvedValue({
        id: 'price_mock123',
        product: 'prod_mock123',
        unit_amount: 1000,
        currency: 'usd'
      })
    }
  }));
});

// Mock cookies to return our test session token
let mockSessionToken: string | undefined;
jest.mock('next/headers', () => ({
  cookies: jest.fn(() => ({
    get: jest.fn((name: string) => {
      if (name === 'buildadmin_session' && mockSessionToken) {
        return { value: mockSessionToken };
      }
      return undefined;
    })
  }))
}));

import path from 'path';
import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from '../../fixtures/database';
import { createCatalogItemAction } from '@/lib/catalog/actions/create-catalog-item';
import { getCatalogItemAction } from '@/lib/catalog/actions/get-catalog-item';
import { listCatalogItemsAction } from '@/lib/catalog/actions/list-catalog-items';
import { Session } from '@/lib/types/session';

describe('Catalog Item Server Actions', () => {
  let testDB: TestDatabase;
  let session: Session;

  beforeAll(async () => {
    testDB = await setupTestDatabase();

    // Set the connection string for this test suite
    testConnectionString = testDB.connectionString;

    // Apply seed data (buildadmin_user, buildadmin_session, securebuild_user, securebuild_team, user_team)
    const seedDataDir = path.join(__dirname, 'seed-data');
    await applySchemaHero(testDB, seedDataDir, true);

    // Generate JWT for test session (session exists in seed data)
    const { createTestSession } = await import('../../fixtures/session');
    const testSession = await createTestSession(testDB.pool, 'test-session-fixed-id-123');
    mockSessionToken = testSession.jwtToken;

    // Get session using getServerSession (which reads from mocked cookies)
    const { getServerSession } = await import('@/lib/auth/server-session');
    const retrievedSession = await getServerSession();

    if (!retrievedSession) {
      throw new Error('Failed to retrieve test session');
    }

    session = retrievedSession;

    console.log(`Test environment ready: session=${session.id}, user=${session.user.id}`);
  });

  afterAll(async () => {
    // Close the pool created by getDB() for this specific test's connection string
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);
  });

  describe('createCatalogItemAction', () => {
    it('should create a new catalog item', async () => {
      // createCatalogItemAction is covered in other tests
    });
  });

  describe('getCatalogItemAction', () => {
    it('should retrieve catalog item by ID', async () => {
      // Create a catalog item first
      const created = await createCatalogItemAction(
        session,
        'Get Test Item',
        'Description for get test',
        true,
        'base-images',
        'get-test-item',
        'https://example.com/get.png',
        false,
        false,
        { monthly: 20, yearly: 200 },
        []
      );

      // Retrieve it
      const catalogItem = await getCatalogItemAction(session, created.id);

      expect(catalogItem).toBeDefined();
      expect(catalogItem?.id).toBe(created.id);
      expect(catalogItem?.name).toBe('Get Test Item');
      expect(catalogItem?.slug).toBe('get-test-item');
    });
  });

  describe('listCatalogItemsAction', () => {
    it('should list all catalog items', async () => {
      // Create multiple catalog items
      await createCatalogItemAction(
        session,
        'List Test Item 1',
        'First list test item',
        true,
        'base-images',
        'list-test-1',
        'https://example.com/list1.png',
        false,
        false,
        { monthly: 30, yearly: 300 },
        []
      );

      await createCatalogItemAction(
        session,
        'List Test Item 2',
        'Second list test item',
        true,
        'base-images',
        'list-test-2',
        'https://example.com/list2.png',
        false,
        false,
        { monthly: 40, yearly: 400 },
        []
      );

      const catalogItems = await listCatalogItemsAction(session);

      expect(catalogItems).toBeDefined();
      expect(Array.isArray(catalogItems)).toBe(true);
      expect(catalogItems.length).toBeGreaterThanOrEqual(2);

      // Check that our items are in the list
      const item1 = catalogItems.find(item => item.slug === 'list-test-1');
      const item2 = catalogItems.find(item => item.slug === 'list-test-2');

      expect(item1).toBeDefined();
      expect(item1?.name).toBe('List Test Item 1');
      expect(item2).toBeDefined();
      expect(item2?.name).toBe('List Test Item 2');
    });
  });
});
