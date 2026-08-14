"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Search, Users, Crown, User, Clock, Mail } from "lucide-react"
import { toast } from "sonner"
import { useSession } from "@/app/hooks/use-session"
import { listAdminUsers } from "@/lib/auth/actions/list-admin-users"
import { listInvites, createInvite, type InviteRecord } from "@/lib/auth/actions/invite"
import { getAuthMethod } from "@/lib/auth/actions/auth-config"
import { User as AdminUser } from "@/lib/types/user"

export default function TeamPage() {
  const { session, isSessionLoading } = useSession()
  const user = session?.user

  const [members, setMembers] = useState<AdminUser[]>([])
  const [invites, setInvites] = useState<InviteRecord[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [authMethod, setAuthMethod] = useState<string | null>(null)

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("")
  const [isInviting, setIsInviting] = useState(false)

  useEffect(() => {
    getAuthMethod().then(setAuthMethod).catch(() => setAuthMethod(null))
  }, [])

  useEffect(() => {
    if (!session) return
    setIsLoading(true)
    Promise.all([listAdminUsers(), listInvites()])
      .then(([users, inviteList]) => {
        setMembers(users)
        setInvites(inviteList)
      })
      .catch(() => toast.error("Failed to load team data"))
      .finally(() => setIsLoading(false))
  }, [session])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.user?.id) return
    setIsInviting(true)
    try {
      await createInvite(inviteEmail)
      toast.success(`Invite sent to ${inviteEmail}`)
      setInviteEmail("")
      // Refresh invites list
      listInvites().then(setInvites).catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send invite")
    } finally {
      setIsInviting(false)
    }
  }

  const formatDate = (date: Date | null) => {
    if (!date) return "Never"
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(date))
  }

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const pendingInvites = invites.filter((i) => !i.acceptedAt && new Date(i.expiresAt) > new Date())

  if (isSessionLoading || !session || !user) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold">Team Management</h1>
          <p className="text-muted-foreground">Manage admin users and pending invites</p>
        </div>
        <div className="relative w-full md:w-auto">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search members..."
            className="w-full rounded-md pl-8 md:w-[250px]"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Invite form — only for admins when AUTH_METHOD=password */}
      {authMethod === "password" && user.isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Invite User
            </CardTitle>
            <CardDescription>Send an invite link to a new admin user</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="flex gap-3">
              <Input
                type="email"
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="max-w-sm"
              />
              <Button type="submit" disabled={isInviting}>
                {isInviting ? "Sending..." : "Send Invite"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Members table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Members
          </CardTitle>
          <CardDescription>Active admin users</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading members...</div>
          ) : (
            <div className="rounded-md border">
              <div className="grid grid-cols-[1fr_auto_auto] p-3 bg-muted/50 text-sm font-medium gap-4">
                <div>User</div>
                <div>Role</div>
                <div>Joined</div>
              </div>
              <div className="divide-y">
                {filteredMembers.length > 0 ? (
                  filteredMembers.map((member) => (
                    <div key={member.id} className="grid grid-cols-[1fr_auto_auto] p-3 items-center gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={member.imageUrl || "/placeholder.svg"} alt={member.name} />
                          <AvatarFallback>{member.name.charAt(0).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{member.name}</div>
                          <div className="text-sm text-muted-foreground truncate">{member.email}</div>
                        </div>
                      </div>
                      <div>
                        <Badge
                          variant="outline"
                          className={member.isAdmin ? "border-amber-500 text-amber-500" : "border-blue-500 text-blue-500"}
                        >
                          {member.isAdmin ? <Crown className="h-3 w-3 mr-1" /> : <User className="h-3 w-3 mr-1" />}
                          {member.isAdmin ? "Admin" : "Member"}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDate(member.createdAt)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-muted-foreground">
                    <Users className="mx-auto h-8 w-8 mb-2" />
                    <p>No members found</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending invites — only shown when AUTH_METHOD=password */}
      {authMethod === "password" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Pending Invites
            </CardTitle>
            <CardDescription>Invites that have been sent but not yet accepted</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground">Loading invites...</div>
            ) : pendingInvites.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">No pending invites</div>
            ) : (
              <div className="rounded-md border">
                <div className="grid grid-cols-[1fr_auto] p-3 bg-muted/50 text-sm font-medium gap-4">
                  <div>Email</div>
                  <div>Expires</div>
                </div>
                <div className="divide-y">
                  {pendingInvites.map((invite) => (
                    <div key={invite.id} className="grid grid-cols-[1fr_auto] p-3 items-center gap-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm truncate">{invite.email}</span>
                      </div>
                      <div className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDate(invite.expiresAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
