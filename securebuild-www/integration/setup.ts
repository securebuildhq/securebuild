/**
 * Global setup for integration tests
 *
 * This file sets up environment variables and mocks for integration tests.
 * - DB_URI placeholder prevents module initialization errors
 */

// Set a placeholder to prevent errors during module initialization
// This will be overwritten by each test suite with the correct connection string
process.env.DB_URI = process.env.DB_URI || 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

// Mock parse-duration to avoid ESM import issues in Jest
jest.mock('parse-duration', () => {
  return jest.fn((str: string) => {
    // Simple mock implementation for common duration strings
    const match = str.match(/^(\d+)\s*(d|day|days|h|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)$/i);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('d')) return value * 24 * 60 * 60 * 1000;
    if (unit.startsWith('h')) return value * 60 * 60 * 1000;
    if (unit.startsWith('m')) return value * 60 * 1000;
    if (unit.startsWith('s')) return value * 1000;

    return null;
  });
});

export {};
