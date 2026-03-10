import {
  Mail,
  ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { findSession } from "@/lib/user/session"
import { listTeamMembersAction } from "@/lib/team/actions/list-team-members"
import { listTeamInvitesAction } from "@/lib/team/actions/list-team-invites"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { InviteMemberDialog } from "./components/InviteMemberDialog"
import { CancelInviteButton } from "./components/CancelInviteButton"
import { ResendInviteButton } from "./components/ResendInviteButton"
import { RemoveMemberButton } from "./components/RemoveMemberButton"

// Combined type for displaying both users and invites
type TeamMemberRow = {
  id: string
  type: "user" | "invite"
  email: string
  firstName?: string
  lastName?: string
  picture?: string
  role?: "admin" | "developer" | "viewer"
  createdAt: Date | string
  lastLoginAt?: Date | null
  lastActiveAt?: Date | null
}

const formatDate = (date: Date | string | null | undefined) => {
  if (!date) return "Never"
  const now = new Date()
  const diffMs = now.getTime() - new Date(date).getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins} minutes ago`
  if (diffHours < 24) return `${diffHours} hours ago`
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  return new Date(date).toLocaleDateString()
}

const formatFullTimestamp = (date: Date | string | null | undefined) => {
  if (!date) return "Never"
  const dateObj = new Date(date)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const formattedDate = dateObj.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  })
  return `${formattedDate} (${timezone})`
}

export default async function TeamMembersPage() {
  // Get session from cookies
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('session')?.value

  if (!sessionToken) {
    redirect('/login')
  }

  const session = await findSession(sessionToken, undefined)
  if (!session || session.expiresAt < new Date()) {
    redirect('/login')
  }

  // Fetch data server-side
  const [members, invites] = await Promise.all([
    listTeamMembersAction(session),
    listTeamInvitesAction(session)
  ])

  // Convert users to rows
  const userRows: TeamMemberRow[] = members.map(member => ({
    id: member.id,
    type: "user" as const,
    email: member.email,
    firstName: member.firstName,
    lastName: member.lastName,
    picture: member.picture,
    createdAt: member.createdAt,
    lastLoginAt: member.lastLoginAt,
    lastActiveAt: member.lastActiveAt,
  }))

  // Convert invites to rows
  const inviteRows: TeamMemberRow[] = invites.map(invite => ({
    id: invite.id,
    type: "invite" as const,
    email: invite.email,
    role: invite.role,
    createdAt: invite.createdAt,
  }))

  // Combine and sort by creation date (newest first)
  const teamMemberRows = [...userRows, ...inviteRows].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return dateB - dateA
  })

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold">Team Members</h2>
          <p className="text-muted-foreground">Manage your team members and their access levels</p>
        </div>
        <InviteMemberDialog />
      </div>

      <Card>
        <CardContent className="p-0">
          <TooltipProvider>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Member
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Role
                    </th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                      Last Active
                    </th>
                    <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {teamMemberRows.map((row) => {
                    const isCurrentUser = row.type === "user" && session?.user?.email === row.email

                    return (
                    <tr
                      key={`${row.type}-${row.id}`}
                      className={`border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted ${
                        row.type === "invite" ? "opacity-70" : ""
                      } ${
                        isCurrentUser ? "bg-blue-50 border-blue-200 ring-1 ring-blue-200" : ""
                      }`}
                    >
                      <td className="p-4 align-middle">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            {row.type === "user" ? (
                              <>
                                <AvatarImage src={row.picture || "/placeholder.svg"} alt={`${row.firstName} ${row.lastName}`} />
                                <AvatarFallback>{row.firstName?.charAt(0)}{row.lastName?.charAt(0)}</AvatarFallback>
                              </>
                            ) : (
                              <AvatarFallback>
                                <Mail className="h-4 w-4" />
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <div>
                            {row.type === "user" ? (
                              <>
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">{row.firstName} {row.lastName}</p>
                                  {isCurrentUser && (
                                    <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                                      You
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground">{row.email}</p>
                              </>
                            ) : (
                              <>
                                <p className="font-medium text-muted-foreground">{row.email}</p>
                                <p className="text-xs text-muted-foreground">Pending invitation</p>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-4 align-middle">
                        {row.type === "user" ? (
                          <Badge variant="secondary">Member</Badge>
                        ) : (
                          <Badge variant="outline">{row.role}</Badge>
                        )}
                      </td>
                      <td className="p-4 align-middle text-sm text-muted-foreground">
                        {row.type === "user" ? (
                          <Tooltip>
                            <TooltipTrigger className="cursor-help">
                              {formatDate(row.lastActiveAt)}
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="font-medium">Last Active</p>
                              <p>{formatFullTimestamp(row.lastActiveAt)}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : "—"}
                      </td>
                      <td className="p-4 align-middle text-right">
                        {(row.type === "user" && !isCurrentUser) || row.type === "invite" ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <ChevronDown className="h-4 w-4" />
                                <span className="sr-only">Open menu</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {row.type === "user" ? (
                                <RemoveMemberButton
                                  memberId={row.id}
                                  memberName={`${row.firstName} ${row.lastName}`}
                                  memberEmail={row.email}
                                />
                              ) : (
                                <>
                                  <ResendInviteButton inviteId={row.id} />
                                  <DropdownMenuSeparator />
                                  <CancelInviteButton inviteId={row.id} inviteEmail={row.email} />
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
              {teamMemberRows.length === 0 && (
                <div className="flex justify-center items-center h-32">
                  <div className="text-center text-muted-foreground">
                    No team members yet. Invite your first team member!
                  </div>
                </div>
              )}
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>
    </>
  )
}
