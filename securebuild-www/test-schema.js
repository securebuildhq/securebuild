#!/usr/bin/env node

// Simple test to verify the database schema
const { Pool } = require('pg');

async function testSchema() {
  const pool = new Pool({
    connectionString: process.env.DB_URI
  });

  try {
    // Test if new columns exist
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'custom_image_external_registry'
      ORDER BY column_name;
    `);
    
    console.log('Columns in custom_image_external_registry:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    });

    // Test if registry_urls column exists in custom_image
    const imageResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'custom_image' AND column_name = 'registry_urls';
    `);
    
    console.log('\nregistry_urls column in custom_image:');
    console.log(imageResult.rows.length > 0 ? '✓ Exists' : '✗ Missing');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

if (!process.env.DB_URI) {
  console.error('DB_URI environment variable is required');
  process.exit(1);
}

testSchema();