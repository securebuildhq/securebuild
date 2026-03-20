"use client"

import { useSession } from "@/app/hooks/use-session"
import { useEffect, useState } from "react"
import { listUsersAction } from "@/lib/user/actions/list-users"
import { UserWithTeam } from "@/lib/user/user"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import Link from "next/link"

export default function UsersPage() {
  const { session, isSessionLoading } = useSession()
  const user = session?.user
  const [users, setUsers] = useState<UserWithTeam[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadUsers() {
      if (!session) return
      try {
        setIsLoading(true)
        const usersData = await listUsersAction(session)
        setUsers(usersData)
      } catch (error) {
        console.error("Failed to load users:", error)
        toast.error("Failed to load users")
      } finally {
        setIsLoading(false)
      }
    }
    loadUsers()
  }, [session])

  const formatDate = (date: Date | null) => {
    if (!date) return "Never"
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (isSessionLoading || !session || !user) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-slate-600 dark:text-slate-400">
            Manage SecureBuild Users
          </p>
        </div>

        {isLoading ? (
          <div className="text-center py-8">
            <div className="text-slate-600 dark:text-slate-400">Loading users...</div>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Teams</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Login</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="font-medium">
                          {user.firstName || user.lastName
                            ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
                            : 'N/A'
                          }
                        </div>
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        {user.teams && user.teams.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {user.teams.map((team) => (
                              <Link key={team.id} href={`/teams/${team.id}`}>
                                <Badge variant="outline" className="hover:bg-slate-100 cursor-pointer">
                                  {team.name}
                                </Badge>
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500">No teams</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{formatDate(user.createdAt)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{formatDate(user.lastLoginAt)}</span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
