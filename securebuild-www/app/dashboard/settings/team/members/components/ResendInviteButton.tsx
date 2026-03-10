"use client"

import { useState } from "react"
import { RotateCcw } from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { useSession } from "@/app/hooks/use-session"
import { resendInviteAction } from "@/lib/team/actions/resend-invite"

interface ResendInviteButtonProps {
  inviteId: string
}

export function ResendInviteButton({ inviteId }: ResendInviteButtonProps) {
  const { session } = useSession(true)
  const [isResending, setIsResending] = useState(false)

  const handleResend = async () => {
    if (!session) return

    try {
      setIsResending(true)
      await resendInviteAction(session, inviteId)
      // Could implement toast notification here for success
    } catch (err) {
      console.error("Failed to resend invitation:", err)
      // Could implement toast notification here for error
    } finally {
      setIsResending(false)
    }
  }

  return (
    <DropdownMenuItem
      onClick={handleResend}
      disabled={isResending}
    >
      {isResending ? (
        <>
          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Resending...
        </>
      ) : (
        <>
          <RotateCcw className="mr-2 h-4 w-4" />
          Resend Invite
        </>
      )}
    </DropdownMenuItem>
  )
}
