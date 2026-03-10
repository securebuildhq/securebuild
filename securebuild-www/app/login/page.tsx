"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft, Mail } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect } from "react"
import { sendMagicLinkAction } from "@/lib/auth/actions/send-magic-link"
import { verifyMagicLinkAction } from "@/lib/auth/actions/verify-magic-link"

function LoginContent() {
  const [isLoading, setIsLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [showCodeInput, setShowCodeInput] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const nextUrl = searchParams.get('next')
    if (nextUrl) {
      localStorage.setItem('postLoginRedirect', nextUrl)
    } else {
      localStorage.removeItem('postLoginRedirect')
    }
  }, [searchParams])

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      await sendMagicLinkAction(email)
      setShowCodeInput(true)
    } catch {
      setError('Failed to send code. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    const storedInvite = sessionStorage.getItem("invite");
    let inviteId: string | undefined;
    if (storedInvite) {
      inviteId = JSON.parse(storedInvite).id;
    }
    try {
      const result = await verifyMagicLinkAction(email, code, inviteId)
      if (result.success && result.jwt) {
        const expires = new Date()
        expires.setDate(expires.getDate() + 7)
        document.cookie = `session=${result.jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`

        const storedRedirect = localStorage.getItem('postLoginRedirect')
        if (storedRedirect) {
          localStorage.removeItem('postLoginRedirect')
          router.push(storedRedirect)
        } else {
          window.location.href = "/dashboard"
        }
      } else {
        setError(result.error || 'Invalid code. Please try again.')
      }
    } catch {
      setError('Verification failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleLogin = () => {
    setIsLoading(true)
    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    const googleRedirectUri = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI

    if (!googleClientId || !googleRedirectUri) {
      console.error(
        "Google client ID or redirect URI is not defined in environment variables."
      )
      setIsLoading(false)
      // Optionally, show an error message to the user
      return
    }

    const scope = "openid profile email"
    const responseType = "code"
    const state = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_STATE

    let authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(
      googleRedirectUri
    )}&response_type=${responseType}&scope=${encodeURIComponent(
      scope
    )}`

    if (state) {
      authUrl += `&state=${encodeURIComponent(state)}`
    }

    window.location.href = authUrl
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 flex h-16 items-center">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
            <span className="text-xl font-bold">SecureBuild</span>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <div className="flex justify-between items-center">
              <CardTitle className="text-2xl font-bold">Log in</CardTitle>
              <Link
                href="/"
                className="text-sm text-muted-foreground hover:text-teal-600 flex items-center gap-1"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </div>
            <CardDescription>Welcome back! Please sign in to your account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showCodeInput ? (
              <>
                <Button
                  variant="outline"
                  className="w-full flex items-center gap-3 h-12 text-lg"
                  onClick={handleGoogleLogin}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <div className="h-5 w-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <svg className="h-6 w-6" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                      <path fill="none" d="M1 1h22v22H1z" />
                    </svg>
                  )}
                  <span>{isLoading ? "Redirecting..." : "Log in with Google"}</span>
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or with email</span>
                  </div>
                </div>

                <form onSubmit={handleSendCode} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="m@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full flex items-center gap-2 h-12"
                    disabled={isLoading || !email}
                  >
                    <Mail className="h-5 w-5" />
                    <span>Continue with Email</span>
                  </Button>
                </form>
              </>
            ) : (
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <p className="text-sm text-center text-muted-foreground">
                  We&apos;ve sent a code to {email}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="code">Verification code</Label>
                  <Input
                    id="code"
                    type="text"
                    placeholder="Enter 6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                    disabled={isLoading}
                    className="text-center text-lg tracking-wider"
                    maxLength={6}
                    pattern="[0-9]{6}"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full h-12"
                  disabled={isLoading || code.length !== 6}
                >
                  {isLoading ? 'Verifying...' : 'Verify and Log in'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setShowCodeInput(false)
                    setCode('')
                    setError('')
                  }}
                  disabled={isLoading}
                >
                  Use a different email
                </Button>
              </form>
            )}
            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <div className="text-sm text-center text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href={searchParams.get('next') ? `/signup?next=${encodeURIComponent(searchParams.get('next')!)}` : "/signup"} className="text-teal-600 hover:text-teal-700 font-medium">
                Sign up
              </Link>
            </div>
          </CardFooter>
        </Card>
      </main>

      {/* Footer */}
      <footer className="py-6 bg-gray-100 dark:bg-gray-800">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 text-center">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} SecureBuild. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginContent />
    </Suspense>
  )
}
