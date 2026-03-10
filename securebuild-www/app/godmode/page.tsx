"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldAlert } from "lucide-react"
import { getGodModeTeamAction } from "@/lib/auth/actions/get-god-mode-team"
import { useSession } from "@/app/hooks/use-session"
import { Team } from "@/lib/types/team"
import { consumeGodModeNonceAction } from "@/lib/auth/actions/consume-god-mode-nonce"

export default function GodModePage() {
  const router = useRouter()
  const { session } = useSession()
  const [team, setTeam] = useState<Team | null>(null)
  const [nonce, setNonce] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingTeam, setIsLoadingTeam] = useState(true)

  useEffect(() => {
    const hash = window.location.hash.substring(1)
    if (hash) {
      setNonce(hash)
    } else {
      setError("No authentication nonce provided. This page cannot be accessed directly.")
      setIsLoadingTeam(false)
    }
  }, [])

  useEffect(() => {
    if (nonce && session) {
      setIsLoadingTeam(true)
      getGodModeTeamAction(session, nonce)
        .then(team => {
          setTeam(team)
          setError(null)
        })
        .catch(err => {
          console.error("Failed to get god mode team", err)
          setError("Failed to get team details. The link may be invalid or expired.")
        })
        .finally(() => {
          setIsLoadingTeam(false)
        })
    }
  }, [nonce, session])

  const handleContinue = async () => {
    if (!nonce || !session) return
    setIsSubmitting(true)
    try {
      const newSessionToken = await consumeGodModeNonceAction(session, nonce)
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);
      document.cookie = `session=${newSessionToken}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

      router.push("/dashboard")
    } catch (err) {
      console.error("Failed to enter god mode", err)
      setError("Failed to enter God Mode. The link may be invalid or expired.")
      setIsSubmitting(false)
    }
  }

  const handleCancel = () => {
    // Close the window/tab if it was opened by a script
    window.close()
    // If window.close() fails (e.g., not opened by a script), redirect to home
    router.push("/")
  }

  const teamName = isLoadingTeam ? "..." : team?.name || "a team"

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100 dark:bg-slate-900">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-yellow-500" />
            Enter God Mode?
          </CardTitle>
          <CardDescription>
            You are about to view the site as the team &quot;{teamName}&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="p-4 rounded-md bg-yellow-50 border border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <strong>Warning:</strong> Any changes you make while in God Mode will be saved and will affect the real team&apos;s data. Please proceed with caution.
            </p>
          </div>
          {error && (
            <div className="p-4 rounded-md bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleContinue}
              disabled={isSubmitting || !!error || isLoadingTeam}
            >
              {isSubmitting ? "Entering..." : "Accept and Continue"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
