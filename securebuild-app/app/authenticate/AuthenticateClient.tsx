'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Shield, AlertCircle } from 'lucide-react'

export default function AuthenticateClient() {
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appName] = useState('AI Agent')
  
  const redirectUrl = searchParams.get('redirect')

  const handleAllow = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Generate nonce server-side
      const response = await fetch('/api/authenticate/generate-nonce', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          redirectUrl,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to generate authorization')
      }

      const { nonce } = await response.json()

      // Redirect to callback URL with nonce
      if (redirectUrl) {
        const url = new URL(redirectUrl)
        url.searchParams.set('nonce', nonce)
        window.location.href = url.toString()
      } else {
        throw new Error('No redirect URL provided')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setIsLoading(false)
    }
  }

  const handleDeny = () => {
    if (redirectUrl) {
      const url = new URL(redirectUrl)
      url.searchParams.set('error', 'access_denied')
      url.searchParams.set('error_description', 'User denied authorization')
      window.location.href = url.toString()
    } else {
      window.location.href = '/'
    }
  }

  useEffect(() => {
    // Validate redirect URL
    if (!redirectUrl) {
      setError('No redirect URL provided')
      return
    }

    try {
      const url = new URL(redirectUrl)
      // Only allow localhost callbacks for security - exact match only
      const allowedHosts = ['localhost', '127.0.0.1', '[::1]', '::1']
      if (!allowedHosts.includes(url.hostname)) {
        setError('Invalid redirect URL: Only localhost callbacks are allowed')
      }
    } catch {
      setError('Invalid redirect URL format')
    }
  }, [redirectUrl])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900 px-4 py-12 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
            <Shield className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-2xl font-bold">Authorize {appName}</CardTitle>
          <CardDescription className="mt-2">
            This application is requesting access to your SecureBuild account
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {!error && (
            <>
              <div className="rounded-lg bg-gray-100 dark:bg-gray-800 p-4">
                <h3 className="font-semibold mb-2">This application will be able to:</h3>
                <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Create and manage packages on your behalf</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Trigger builds and monitor their status</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Access package execution logs and details</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Update package configurations</span>
                  </li>
                </ul>
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  <strong>Note:</strong> This token will expire in 24 hours. You can revoke access at any time from your account settings.
                </p>
              </div>

              {redirectUrl && (
                <div className="text-xs text-gray-500 dark:text-gray-400 break-all">
                  Redirect to: {redirectUrl}
                </div>
              )}
            </>
          )}

          <div className="flex space-x-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleDeny}
              disabled={isLoading}
            >
              Deny
            </Button>
            <Button
              className="flex-1"
              onClick={handleAllow}
              disabled={isLoading || !!error}
            >
              {isLoading ? 'Authorizing...' : 'Allow'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}