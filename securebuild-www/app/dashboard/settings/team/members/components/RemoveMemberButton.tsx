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
import { removeMemberAction } from "@/lib/team/actions/remove-member"
import { useRouter } from "next/navigation"

interface RemoveMemberButtonProps {
  memberId: string
  memberName: string
  memberEmail: string
}

export function RemoveMemberButton({ memberId, memberName, memberEmail }: RemoveMemberButtonProps) {
  const { session } = useSession(true)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const handleRemove = async () => {
    if (!session) return

    try {
      setIsRemoving(true)
      await removeMemberAction(session, memberId)

      // Close dialog and refresh page
      setOpen(false)
      router.refresh()
    } catch (err) {
      console.error("Failed to remove member:", err)
      // Could implement toast notification here
    } finally {
      setIsRemoving(false)
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
          Remove
        </DropdownMenuItem>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove{" "}
            <strong>{memberName}</strong> ({memberEmail}) from your team?
            This action cannot be undone and they will lose access to all team resources.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemoving}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRemove}
            disabled={isRemoving}
            className="bg-red-600 hover:bg-red-700 focus:ring-3 focus:ring-red-600"
          >
            {isRemoving ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Removing...
              </>
            ) : (
              "Remove Member"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
