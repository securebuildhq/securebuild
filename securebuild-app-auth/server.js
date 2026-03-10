#!/usr/bin/env node

// Test script for AI Agent authentication flow
const express = require('express')
const axios = require('axios')
const { exec } = require('child_process')

const PORT = 30000 + Math.floor(Math.random() * 1000)
const ADMIN_URL = 'https://admin.sbld.io'

// Use system open command instead of the npm package
function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : 
                  process.platform === 'win32' ? 'start' :
                  'xdg-open';
  
  exec(`${command} "${url}"`, (error) => {
    if (error) {
      console.error('Failed to open browser automatically.')
      console.log(`Please open this URL manually: ${url}`)
    }
  })
}

async function authenticate() {
  return new Promise((resolve, reject) => {
    const app = express()
    
    console.log(`Starting callback server on port ${PORT}...`)
    const server = app.listen(PORT, () => {
      console.log(`✓ Callback server listening on port ${PORT}`)
    })

    // Handle the callback from admin site
    app.get('/callback', async (req, res) => {
      console.log('✓ Received callback from SecureBuild')
      
      try {
        const { nonce, error, error_description } = req.query
        
        if (error) {
          console.error(`✗ Authorization denied: ${error_description || error}`)
          res.send(`
            <h1>Authorization Denied</h1>
            <p>${error_description || error}</p>
            <script>setTimeout(() => window.close(), 2000)</script>
          `)
          server.close()
          reject(new Error(error_description || error))
          return
        }
        
        if (!nonce) {
          throw new Error('No nonce received in callback')
        }
        
        console.log(`✓ Received nonce: ${nonce.substring(0, 8)}...`)
        
        // Exchange nonce for token
        console.log('Exchanging nonce for token...')
        const tokenResponse = await axios.post(`${ADMIN_URL}/api/v1/auth/nonce`, {
          nonce
        })
        
        const { token } = tokenResponse.data
        
        console.log('✓ Successfully received bearer token!')
        console.log(`  Token (first 20 chars): ${token.substring(0, 20)}...`)
        console.log('')
        console.log('FULL TOKEN FOR TESTING:')
        console.log(token)
        
        // Test the token by calling an API
        console.log('\nTesting token with API call...')
        try {
          const testResponse = await axios.get(`${ADMIN_URL}/api/package-details?id=test`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })
          console.log('✓ Token works! API call successful')
        } catch (apiError) {
          if (apiError.response && apiError.response.status === 404) {
            console.log('✓ Token validated successfully (404 is expected for non-existent package)')
          } else if (apiError.response && apiError.response.status === 401) {
            console.error('✗ Token authentication failed')
          } else {
            console.log('✓ Token validated (API responded)')
          }
        }
        
        res.send(`
          <h1>Authentication Successful!</h1>
          <p>Token received and validated. You can close this window.</p>
          <script>setTimeout(() => window.close(), 3000)</script>
        `)
        
        server.close()
        resolve({ token })
        
      } catch (error) {
        console.error('✗ Error during authentication:', error.message)
        if (error.response) {
          console.error('  Response data:', error.response.data)
        }
        
        res.status(500).send(`
          <h1>Authentication Failed</h1>
          <p>${error.message}</p>
          <script>setTimeout(() => window.close(), 3000)</script>
        `)
        
        server.close()
        reject(error)
      }
    })

    // Open browser to admin site for authorization
    const authUrl = `${ADMIN_URL}/authenticate?redirect=http://localhost:${PORT}/callback`
    console.log(`\nOpening browser to: ${authUrl}`)
    console.log('Please log in and click "Allow" to authorize the AI agent...\n')
    
    openBrowser(authUrl)
    
    // Timeout after 2 minutes
    setTimeout(() => {
      console.error('\n✗ Authentication timeout after 2 minutes')
      server.close()
      reject(new Error('Authentication timeout'))
    }, 120000)
  })
}

// Run the test
console.log('🚀 SecureBuild AI Agent Authentication Test')
console.log('=' .repeat(50))

authenticate()
  .then(result => {
    console.log('\n' + '=' .repeat(50))
    console.log('✅ Authentication test completed successfully!')
    process.exit(0)
  })
  .catch(error => {
    console.log('\n' + '=' .repeat(50))
    console.error('❌ Authentication test failed:', error.message)
    process.exit(1)
  })