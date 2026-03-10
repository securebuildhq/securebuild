"use client"

import { useState, useEffect } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Search, MoreHorizontal, Mail, UserPlus, Shield, User, Users, Crown } from "lucide-react"
import { User as TeamMember } from "@/lib/types/user"
import { Session } from "@/lib/types/session"
import { useSession } from "@/app/hooks/use-session"

// Role definitions
const roles = [
  {
    id: "admin",
    name: "Admin",
    description: "Full access to all resources",
    icon: <Crown className="h-4 w-4" />,
  },
  {
    id: "member",
    name: "Member",
    description: "Can create and manage pipelines",
    icon: <User className="h-4 w-4" />,
  },
  {
    id: "viewer",
    name: "Viewer",
    description: "Read-only access to pipelines and executions",
    icon: <Shield className="h-4 w-4" />,
  },
]

export default function TeamPage() {
  const { session, isSessionLoading } = useSession();
  const user = session?.user;
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("member")
  const [loading, setLoading] = useState(true)


  // Filter team members based on search query
  const filteredTeamMembers = teamMembers.filter(
    (member) =>
      member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (member.isAdmin ? "admin" : "member").toLowerCase().includes(searchQuery.toLowerCase()),
  )

  // Handle role change
  const handleRoleChange = async (memberId: string, newRole: string) => {
    // TODO: Implement role change functionality
    console.log("Role change:", memberId, newRole)
  }

  // Handle member removal
  const handleRemoveMember = async (memberId: string) => {
    // TODO: Implement remove member functionality
    console.log("Remove member:", memberId)
  }

  // Format date
  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date)
  }

  // Get role info
  const getRoleInfo = (isAdmin: boolean) => {
    return isAdmin ? roles[0] : roles[1] // Default to member if not admin
  }

  if (isSessionLoading || !session || !user) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading team management...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
            <div>
              <h1 className="text-3xl font-bold">Team Management</h1>
              <p className="text-muted-foreground">Manage your team members and their access</p>
            </div>
            <div className="flex flex-col space-y-2 md:flex-row md:space-x-2 md:space-y-0">
              <div className="relative w-full md:w-auto">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search team members..."
                  className="w-full rounded-md pl-8 md:w-[250px]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>Manage your team members and their roles</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-8">
                <div className="rounded-md border">
                  <div className="grid grid-cols-1 md:grid-cols-4 p-4 bg-muted/50">
                    <div className="font-medium">User</div>
                    <div className="font-medium hidden md:block text-center">Role</div>
                    <div className="font-medium hidden md:block">Status</div>
                    <div className="font-medium hidden md:block">Joined</div>
                  </div>
                  <div className="divide-y">
                    {filteredTeamMembers.length > 0 ? (
                      filteredTeamMembers.map((member) => {
                        console.log("Current user id:", user.id, typeof user.id, "Member id:", member.id, typeof member.id);
                        return (
                          <div key={member.id} className="grid grid-cols-1 md:grid-cols-4 p-4 items-center">
                            <div className="flex items-center gap-3 mb-2 md:mb-0">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={member.imageUrl || "/placeholder.svg"} alt={member.name} />
                                <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="font-medium">{member.name}</div>
                                <div className="text-sm text-muted-foreground">{member.email}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mb-2 md:mb-0 justify-center">
                              <div className="md:hidden font-medium text-sm text-muted-foreground mr-2">Role:</div>
                              <Badge
                                variant="outline"
                                className={`flex items-center gap-1 ${
                                  member.isAdmin
                                    ? "border-amber-500 text-amber-500"
                                    : "border-blue-500 text-blue-500"
                                }`}
                              >
                                {getRoleInfo(member.isAdmin).icon}
                                {getRoleInfo(member.isAdmin).name}
                              </Badge>
                            </div>
                            <div className="flex items-center mb-2 md:mb-0">
                              <div className="md:hidden font-medium text-sm text-muted-foreground mr-2">Status:</div>
                              <Badge variant="success">Active</Badge>
                            </div>
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="md:hidden font-medium text-sm text-muted-foreground mr-2">Joined:</div>
                                <span className="text-sm">{formatDate(member.createdAt)}</span>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => handleRoleChange(member.id, "admin")}
                                    disabled={member.isAdmin || member.id === user.id}
                                  >
                                    <Crown className="mr-2 h-4 w-4" />
                                    <span>Make Admin</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleRoleChange(member.id, "member")}
                                    disabled={!member.isAdmin || member.id === user.id}
                                  >
                                    <User className="mr-2 h-4 w-4" />
                                    <span>Make Member</span>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleRemoveMember(member.id)}
                                    disabled={member.id === user.id}
                                    className={member.id !== user.id ? "text-red-600" : undefined}
                                  >
                                    <UserPlus className="mr-2 h-4 w-4" />
                                    <span>Remove</span>
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className="p-8 text-center">
                        <Users className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">No team members found</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium">About Roles</h3>
                  <div className="grid gap-4 md:grid-cols-3">
                    {roles.map((role) => (
                      <div key={role.id} className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          {role.icon}
                          <h4 className="font-medium">{role.name}</h4>
                        </div>
                        <p className="text-sm text-muted-foreground">{role.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
    </div>
  )
}
