"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { useSession } from "@/app/hooks/use-session"
import { cancelInviteAction } from "@/lib/team/actions/cancel-invite"
import { useRouter } from "next/navigation"

interface CancelInviteButtonProps {
  inviteId: string
  inviteEmail: string
}

export function CancelInviteButton({ inviteId, inviteEmail }: CancelInviteButtonProps) {
  const { session } = useSession(true)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const handleCancel = async () => {
    if (!session) return

    try {
      setIsCancelling(true)
      await cancelInviteAction(session, inviteId)

      // Close dialog and refresh page
      setOpen(false)
      router.refresh()
    } catch (err) {
      console.error("Failed to cancel invitation:", err)
      // Could implement toast notification here
    } finally {
      setIsCancelling(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <DropdownMenuItem
          className="text-red-600"
          onSelect={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Cancel Invite
        </DropdownMenuItem>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Invitation</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel the invitation for{" "}
            <strong>{inviteEmail}</strong>?
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCancelling}>
            Keep Invitation
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleCancel}
            disabled={isCancelling}
            className="bg-red-600 hover:bg-red-700 focus:ring-3 focus:ring-red-600"
          >
            {isCancelling ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Cancelling...
              </>
            ) : (
              "Cancel Invitation"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
