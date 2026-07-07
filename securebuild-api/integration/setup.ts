/**
 * Global setup for integration tests
 *
 * This file sets up environment variables for integration tests.
 * - DB_URI placeholder prevents module initialization errors
 */

// Set a placeholder to prevent errors during module initialization
// This will be overwritten by each test suite with the correct connection string
process.env.DB_URI = process.env.DB_URI || 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

export {};
