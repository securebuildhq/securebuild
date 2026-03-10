module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/lib', '<rootDir>/app'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'lib/**/*.ts',
    'app/**/*.ts',
    '!lib/**/*.d.ts',
    '!app/**/*.d.ts',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};