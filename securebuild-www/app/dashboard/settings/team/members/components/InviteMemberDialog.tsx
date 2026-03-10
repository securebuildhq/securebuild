"use client"

import { useState } from "react"
import { Mail, Plus, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSession } from "@/app/hooks/use-session"
import { inviteTeamMemberAction } from "@/lib/team/actions/invite-member"
import { useRouter } from "next/navigation"

export function InviteMemberDialog() {
  const { session } = useSession(true)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"admin" | "developer" | "viewer">("developer")
  const [isInviting, setIsInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleInvite = async () => {
    if (!session || !email) return

    try {
      setIsInviting(true)
      setError(null)

      await inviteTeamMemberAction(session, email, role)

      // Close modal and reset form
      setOpen(false)
      setEmail("")
      setRole("developer")

      // Refresh the page to show the new invite
      router.refresh()
    } catch (err) {
      console.error("Failed to send invitation:", err)
      setError("Failed to send invitation. Please try again.")
    } finally {
      setIsInviting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Invite Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>Send an invitation to join your team</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-3 rounded-md">
              {error}
            </div>
          )}
          <div className="grid gap-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isInviting}
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="role" className="text-sm font-medium">
              Role
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="justify-between w-full" disabled={isInviting}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                  <ChevronDown className="h-4 w-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56">
                <DropdownMenuLabel>Select Role</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setRole("admin")}>Admin</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRole("developer")}>Developer</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRole("viewer")}>Viewer</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isInviting}>
            Cancel
          </Button>
          <Button onClick={handleInvite} disabled={!email || isInviting}>
            {isInviting ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Send Invitation
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
