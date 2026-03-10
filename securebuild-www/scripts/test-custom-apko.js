#!/usr/bin/env node

/**
 * Node.js script to test the Custom APKO API
 * Usage: SERVICE_ACCOUNT_TOKEN=your_token node scripts/test-custom-apko.js
 */

const https = require('https');
const http = require('http');

const API_BASE = 'http://localhost:3001';
const REGISTRY_URL = 'ttl.sh/dmitriy';
const REGISTRY_USERNAME = 'username';
const REGISTRY_PASSWORD = 'password';

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({ status: res.statusCode, data: jsonData });
        } catch (error) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.end();
  });
}

function generateRandomId() {
  return 'ci' + Math.random().toString(36).substring(2, 18);
}

async function main() {
  log('blue', '=== Custom APKO API Test Script ===');

  // Check for service account token
  const token = process.env.SERVICE_ACCOUNT_TOKEN;
  if (!token) {
    log('red', 'Error: SERVICE_ACCOUNT_TOKEN environment variable is required');
    console.log('Please set your service account token:');
    console.log('export SERVICE_ACCOUNT_TOKEN=\'your_token_here\'');
    process.exit(1);
  }

  log('yellow', `Using API endpoint: ${API_BASE}`);
  log('yellow', `Using registry: ${REGISTRY_URL}`);
  console.log();

  try {
    // Step 1: Create external registry credentials
    log('blue', 'Step 1: Creating external registry credentials...');
    
    const customImageId = generateRandomId();
    console.log(`Using test custom image ID: ${customImageId}`);

    const registryPayload = {
      custom_image_id: customImageId,
      registry_url: REGISTRY_URL,
      username: REGISTRY_USERNAME,
      password: REGISTRY_PASSWORD
    };

    console.log('Creating registry credentials...');
    const registryResponse = await makeRequest(`${API_BASE}/api/v1/custom-external-registry`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: registryPayload
    });

    console.log('Registry API Response:');
    console.log(JSON.stringify(registryResponse.data, null, 2));

    if (!registryResponse.data.success) {
      log('red', '✗ Failed to create registry credentials');
      process.exit(1);
    }

    const registryId = registryResponse.data.registry_id;
    log('green', `✓ Registry credentials created successfully (ID: ${registryId})`);
    console.log();

    // Step 2: Submit APKO configuration
    log('blue', 'Step 2: Submitting APKO configuration...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const apkoYaml = `contents:
  repositories:
    - https://apk.cve0.io
  keyring:
    - https://apk.cve0.io/key/cve0-signing.rsa.pub
  packages:
    - ca-certificates-bundle
    - busybox
    - curl
entrypoint:
  command: /bin/busybox
cmd: sh
work-dir: /app
environment:
  PATH: /usr/local/bin:/usr/bin:/bin
  HOME: /app
accounts:
  run-as: nobody
archs:
  - x86_64
  - aarch64`;

    // Base64 encode the YAML to preserve exact formatting
    const apkoConfigBase64 = Buffer.from(apkoYaml, 'utf-8').toString('base64');
    
    const apkoPayload = {
      name: `test-busybox-${timestamp}`,
      tags: ['latest', `test-${Date.now()}`],
      config: apkoConfigBase64,
      readme: 'Test APKO configuration created by automation script',
      registry_urls: [REGISTRY_URL]
    };

    console.log('APKO Configuration to submit:');
    console.log(JSON.stringify(apkoPayload, null, 2));
    console.log();

    console.log('Submitting APKO configuration...');
    const apkoResponse = await makeRequest(`${API_BASE}/api/v1/custom-apko`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: apkoPayload
    });

    console.log('APKO API Response:');
    console.log(JSON.stringify(apkoResponse.data, null, 2));

    if (!apkoResponse.data.success) {
      log('red', '✗ Failed to create APKO configuration');
      const errorMsg = apkoResponse.data.error || 'Unknown error';
      console.log(`Error: ${errorMsg}`);
      process.exit(1);
    }

    const customApkoId = apkoResponse.data.custom_apko_id;
    const createdCustomImageId = apkoResponse.data.custom_image_id;
    log('green', '✓ APKO configuration created successfully');
    console.log(`Custom Image ID: ${createdCustomImageId}`);
    console.log(`Custom APKO ID: ${customApkoId}`);
    console.log();

    // Step 3: Retrieve the created APKO configuration
    log('blue', 'Step 3: Retrieving APKO configuration...');

    const getResponse = await makeRequest(`${API_BASE}/api/v1/custom-apko?custom_apko_id=${customApkoId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('Retrieved APKO Configuration:');
    console.log(JSON.stringify(getResponse.data, null, 2));

    if (getResponse.data.config) {
      console.log('\nDecoded YAML config:');
      const decodedYaml = Buffer.from(getResponse.data.config, 'base64').toString('utf-8');
      console.log(decodedYaml);
    }

    if (getResponse.data.id) {
      log('green', '✓ Successfully retrieved APKO configuration');
    } else {
      log('yellow', '⚠ Could not retrieve APKO configuration');
    }
    console.log();

    // Step 4: List external registries for the custom image
    log('blue', 'Step 4: Listing external registries...');

    const registriesResponse = await makeRequest(`${API_BASE}/api/v1/custom-external-registry?custom_image_id=${createdCustomImageId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('External Registries:');
    console.log(JSON.stringify(registriesResponse.data, null, 2));

    if (registriesResponse.data.registries) {
      const registryCount = registriesResponse.data.registries.length;
      log('green', `✓ Found ${registryCount} external registr${registryCount !== 1 ? 'ies' : 'y'}`);
    } else {
      log('yellow', '⚠ No external registries found');
    }

    console.log();
    log('green', '=== Test completed successfully! ===');
    console.log();
    console.log('Summary:');
    console.log(`- Custom Image ID: ${createdCustomImageId}`);
    console.log(`- Custom APKO ID: ${customApkoId}`);
    console.log(`- Registry ID: ${registryId}`);
    console.log(`- Registry URL: ${REGISTRY_URL}`);
    console.log();
    console.log('You can view this custom image in the SecureBuild dashboard at:');
    console.log(`${API_BASE}/dashboard/custom-images/${createdCustomImageId}`);

  } catch (error) {
    log('red', `Error: ${error.message}`);
    process.exit(1);
  }
}

// Check if jq is available
function checkJq() {
  try {
    require('child_process').execSync('which jq', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

if (!checkJq()) {
  log('yellow', 'Note: jq not found. JSON output may be less readable.');
  log('yellow', 'Install jq for better JSON formatting: brew install jq');
  console.log();
}

main().catch(error => {
  log('red', `Unexpected error: ${error.message}`);
  process.exit(1);
});