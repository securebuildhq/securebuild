#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

// Run the TypeScript version using ts-node with the E2E tsconfig
const tsScript = path.join(__dirname, 'run-go-e2e.ts');
const tsConfig = path.join(__dirname, '..', 'e2e', 'tsconfig.json');
execSync(`npx ts-node --project ${tsConfig} ${tsScript}`, { stdio: 'inherit' });
