"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { UserPlus, Mail, Calendar, Loader2 } from "lucide-react"
import { useSession } from "@/app/hooks/use-session"
import { Invite } from "@/lib/types/invite"
import { getInviteByTokenAction } from "@/lib/team/actions/get-invite-by-token"
import { acceptInviteAction } from "@/lib/team/actions/accept-invite"
import { useRouter } from "next/navigation"
import { GoogleLogo } from "@/components/icons/GoogleLogo"
import { sendMagicLinkAction } from "@/lib/auth/actions/send-magic-link"
import { verifyMagicLinkAction } from "@/lib/auth/actions/verify-magic-link"

export default function InvitePage() {
  const { session } = useSession(false) // Don't require auth for viewing invite
  const [invite, setInvite] = useState<Invite | null>(null)
  const [teamName, setTeamName] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [showCodeInput, setShowCodeInput] = useState(false)
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const router = useRouter();
  
  const loadInvite = useCallback(async (token: string) => {
    try {
      setIsLoading(true)
      setError(null)

      const inviteData = await getInviteByTokenAction(session, token)
      setInvite(inviteData.invite);
      setTeamName(inviteData.teamName);
    } catch (_err) {
      console.error("Failed to load invite:", _err)
      setError("Failed to load invitation. The invite may have expired or been cancelled.")
    } finally {
      setIsLoading(false)
    }
  }, [session])

  useEffect(() => {
    // Extract invite ID from hash
    const hash = window.location.hash
    if (hash && hash.startsWith('#')) {
      const t = hash.substring(1)
      setToken(t)
      loadInvite(t)
    } else {
      setError("No invite ID found in URL")
      setIsLoading(false)
    }
  }, [loadInvite])

  const onHandleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invite) return;

    setError('')
    setVerificationError(null)
    setIsSendingCode(true)
    sessionStorage.setItem("invite", JSON.stringify(invite));

    try {
      await sendMagicLinkAction(invite.email)
      setShowCodeInput(true)
    } catch {
      setError('Failed to send code. Please try again.')
    } finally {
      setIsSendingCode(false)
    }
  }

  const onHandleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invite) return;

    setVerificationError(null)
    setIsVerifyingCode(true)

    try {
      const storedInvite = sessionStorage.getItem("invite");
      let inviteId: string | undefined;
      if (storedInvite) {
        inviteId = JSON.parse(storedInvite).id;
      }
      const result = await verifyMagicLinkAction(invite.email, code, inviteId)
      if (result.success && result.jwt) {
        const expires = new Date()
        expires.setDate(expires.getDate() + 7)
        document.cookie = `session=${result.jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`
        router.push(`/dashboard`);
      } else {
        setVerificationError(result.error || 'Invalid code. Please try again.')
      }
    } catch {
      setVerificationError('Verification failed. Please try again.')
    } finally {
      setIsVerifyingCode(false)
    }
  }

  const onLogoutToAccept = () => {
    const cookieName = 'session'; // <<<<< IMPORTANT: Change this if your cookie name is different
    document.cookie = `${cookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;

    onCreateAccountAndAccept();
  }

  const onAcceptInvitation = async () => {
    if (!session || !invite || !token) {
      return;
    }

    const jwt = await acceptInviteAction(session, token);
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);
    document.cookie = `session=${jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

    router.push(`/dashboard`);
  }

  const onCreateAccountAndAccept = () => {
    // create a next variable in session storage so we can come back and accept
    sessionStorage.setItem("invite", JSON.stringify(invite));

    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    const googleRedirectUri = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI

    if (!googleClientId || !googleRedirectUri) {
      return
    }

    const scope = "openid profile email"
    const responseType = "code"
    const prompt = "consent" // Force the consent screen every time, good for development
    const state = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_STATE

    let authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${googleClientId}&redirect_uri=${encodeURIComponent(
      googleRedirectUri
    )}&response_type=${responseType}&scope=${encodeURIComponent(
      scope
    )}&prompt=${prompt}`

    if (state) {
      authUrl += `&state=${encodeURIComponent(state)}`
    }

    window.location.href = authUrl
  }


  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
            <p className="text-gray-600">Loading invitation...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-red-600">Invitation Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button variant="outline" onClick={() => window.location.href = '/'}>
              Go to Homepage
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Invitation Not Found</CardTitle>
            <CardDescription>This invitation could not be found or may have expired.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <UserPlus className="h-6 w-6 text-blue-600" />
          </div>
          <CardTitle className="text-2xl">You&apos;re Invited!</CardTitle>
          <CardDescription>
            You&apos;ve been invited to join {teamName} on SecureBuild
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <Mail className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-700">Invited Email</p>
                <p className="text-sm text-gray-600">{invite.email}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <Badge variant="outline" className="text-sm">
                {invite.role?.charAt(0).toUpperCase() + invite.role?.slice(1)}
              </Badge>
              <div>
                <p className="text-sm font-medium text-gray-700">Role</p>
                <p className="text-xs text-gray-600">
                  You&apos;ll be added as a {invite.role} to the team
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <Calendar className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-sm font-medium text-gray-700">Invited On</p>
                <p className="text-sm text-gray-600">{formatDate(invite.createdAt)}</p>
              </div>
            </div>
          </div>

          <div className="border-t pt-6">
            <p className="text-sm text-gray-600 text-center mb-4">
              {session ?
                <>You are signed in as {session.user.email}.</>
                :
                <>To accept this invitation, you&apos;ll need to create an account.</>
              }
            </p>

            <div className="flex flex-col gap-3">
              {session ? (
                session.user.email === invite.email ? (
                  <Button className="w-full" onClick={onAcceptInvitation}>
                    Accept Invitation as {session.user.email}
                  </Button>
                ) : (
                  <Button className="w-full" onClick={onLogoutToAccept}>
                    Log out and accept invitation as {invite.email}
                  </Button>
                )
              ) : (
                <>
                  <Button className="w-full" onClick={onCreateAccountAndAccept}>
                    <GoogleLogo className="mr-2 h-4 w-4" />
                    Create Account with Google
                  </Button>
                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">
                        Or
                      </span>
                    </div>
                  </div>
                  {!showCodeInput ? (
                    <div className="flex w-full items-center space-x-2">
                      <Input
                        type="email"
                        value={invite.email || ""}
                        readOnly
                        className="flex-1 bg-gray-100"
                      />
                      <Button type="button" variant="secondary" onClick={onHandleSendCode} disabled={isSendingCode}>
                        {isSendingCode && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isSendingCode ? 'Sending...' : 'Send Code'}
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={onHandleVerifyCode} className="space-y-4">
                      <p className="text-sm text-center text-gray-600">
                        We&apos;ve sent a code to {invite.email}. Please enter it below.
                      </p>
                      <Input
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="123456"
                        required
                        className="text-center"
                      />
                      {verificationError && (
                        <p className="text-sm text-red-600 text-center">{verificationError}</p>
                      )}
                      <Button type="submit" className="w-full" disabled={isVerifyingCode}>
                        {isVerifyingCode && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isVerifyingCode ? 'Verifying...' : 'Verify Code'}
                      </Button>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  )
}
