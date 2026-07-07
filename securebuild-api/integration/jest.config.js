/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/integration/**/test.ts', '**/integration/**/*.test.ts'],
  testTimeout: 300000, // 5 minutes for container startup, server boot, and schema application
  maxWorkers: 1, // Serial: Testcontainers + spawned servers share Docker/network resources
  verbose: true,
  collectCoverage: false,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        moduleResolution: 'node',
        resolveJsonModule: true,
        isolatedModules: true,
      },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../$1',
    '^server-only$': '<rootDir>/../__mocks__/server-only.js',
  },
  setupFiles: ['<rootDir>/setup.ts'],
  setupFilesAfterEnv: [],
  globalSetup: undefined,
  globalTeardown: undefined,
};
