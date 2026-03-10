/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/integration/**/test.ts', '**/integration/**/*.test.ts'],
  testTimeout: 120000, // 2 minutes for container startup and schema application
  maxWorkers: '50%', // Run tests in parallel (50% of CPU cores)
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
  transformIgnorePatterns: [
    'node_modules/(?!(parse-duration)/)',
  ],
  setupFiles: ['<rootDir>/setup.ts'],
  setupFilesAfterEnv: [],
  globalSetup: undefined,
  globalTeardown: undefined,
};
