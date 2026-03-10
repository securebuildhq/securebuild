/**
 * Integration tests for team server actions
 * Tests getTeamAction and listServiceAccountsAction
 */

import { Pool } from "pg";
import path from "path";
import { setupTestDatabase, teardownTestDatabase, applySchemaHero, TestDatabase } from "../../fixtures/database";
import { createTestServiceAccount } from "../../fixtures/auth";
import { getTeamAction } from "@/lib/team/actions/get-team";
import { listServiceAccountsAction } from "@/lib/team/actions/list-service-accounts";
import { Session } from "@/lib/types/session";
import { getUser } from "@/lib/user/user";
import { createSession } from "@/lib/user/session";

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

// Mock session validation since we're testing team actions, not authentication
jest.mock("@/lib/utils/session-validation", () => ({
  requireValidSession: jest.fn((sess: Session) => Promise.resolve(sess)),
}));

describe("Team Server Actions", () => {
  let testDB: TestDatabase;
  let testPool: Pool;
  let teamId: string;
  let userId: string;
  let session: Session;

  beforeAll(async () => {
    testDB = await setupTestDatabase();
    testPool = testDB.pool;

    // Set the connection string for this test suite
    testConnectionString = testDB.connectionString;

    // Apply seed data for team actions tests (schema already applied by setupTestDatabase)
    const seedDataDir = path.join(__dirname, "seed-data");
    await applySchemaHero(testDB, seedDataDir, true);

    // Use the seeded team and user
    teamId = "test-team-beta";
    userId = "test-user-123";

    // Get the user from the database
    const user = await getUser(userId);
    if (!user) {
      throw new Error("Failed to get test user from database");
    }

    // Create a real session using the seeded data
    session = await createSession(user);

    console.log(`Test environment ready: teamId=${teamId}, userId=${userId}`);
  });

  afterAll(async () => {
    // Close the pool created by getDB() for this specific test's connection string
    const { closePoolByUri } = await import("@/lib/data/db");
    await closePoolByUri(testDB.connectionString);

    await teardownTestDatabase(testDB);
  });

  describe("getTeamAction", () => {
    it("should retrieve team by ID from session", async () => {
      const team = await getTeamAction(session);

      expect(team).toBeDefined();
      expect(team.id).toBe(teamId);
      expect(team.name).toBe("Test Team Beta");
      expect(team.registryUsername).toBe("test-beta");
      expect(team.full_catalog_access).toBe(true);
    });
  });

  describe("listServiceAccountsAction", () => {
    it("should return empty array when team has no service accounts", async () => {
      const serviceAccounts = await listServiceAccountsAction(session);

      expect(serviceAccounts).toBeDefined();
      expect(Array.isArray(serviceAccounts)).toBe(true);
      expect(serviceAccounts.length).toBe(0);
    });

    it("should list all service accounts for a team and not include other teams", async () => {
      // Create test service accounts for test-team-beta
      const sa1 = await createTestServiceAccount(testPool, teamId, "Test SA 1");
      const sa2 = await createTestServiceAccount(testPool, teamId, "Test SA 2");

      // Create service account for other team (other-team-456 is in seed data)
      await createTestServiceAccount(testPool, "other-team-456", "Other Team SA");

      const serviceAccounts = await listServiceAccountsAction(session);

      expect(serviceAccounts).toBeDefined();
      expect(Array.isArray(serviceAccounts)).toBe(true);
      expect(serviceAccounts.length).toBe(2);

      // Check first service account
      const foundSa1 = serviceAccounts.find(sa => sa.id === sa1.id);
      expect(foundSa1).toBeDefined();
      expect(foundSa1?.name).toBe("Test SA 1");
      expect(foundSa1?.partialValue).toBe(sa1.partialValue);

      // Check second service account
      const foundSa2 = serviceAccounts.find(sa => sa.id === sa2.id);
      expect(foundSa2).toBeDefined();
      expect(foundSa2?.name).toBe("Test SA 2");
      expect(foundSa2?.partialValue).toBe(sa2.partialValue);

      // Verify no service accounts from other teams
      expect(serviceAccounts.every(sa =>
        sa.name === "Test SA 1" || sa.name === "Test SA 2"
      )).toBe(true);
    });
  });
});
