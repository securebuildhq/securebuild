"use client"

import { useState, useEffect } from "react"
import { useSession } from "@/app/hooks/use-session"
import { useRouter } from "next/navigation"

import { listTeamsAction } from "@/lib/team/actions/list-teams"
import { Team } from "@/lib/types/team"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function TeamsPage() {
  const { session, isSessionLoading } = useSession()
  const user = session?.user
  const router = useRouter()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return

    const fetchTeams = async () => {
      try {
        setLoading(true)
        const teamsData = await listTeamsAction()
        setTeams(teamsData)
      } catch (err) {
        console.error("Failed to fetch teams:", err)
        setError("Failed to load teams")
      } finally {
        setLoading(false)
      }
    }

    fetchTeams()
  }, [session])

  const handleTeamClick = (teamId: string) => {
    router.push(`/teams/${teamId}`)
  }

  if (isSessionLoading || !session || !user) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">Teams</h1>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>All Teams</CardTitle>
              <CardDescription>
                Manage and view all teams in the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">
                  <p className="text-slate-600 dark:text-slate-400">Loading teams...</p>
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <p className="text-red-600 dark:text-red-400">{error}</p>
                </div>
              ) : teams.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-600 dark:text-slate-400">No teams found</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Created At</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teams.map((team) => (
                      <TableRow
                        key={team.id}
                      >
                        <TableCell className="font-medium">{team.name}</TableCell>
                        <TableCell className="font-mono text-sm text-slate-600 dark:text-slate-400">
                          {team.id}
                        </TableCell>
                        <TableCell>
                          {new Date(team.createdAt).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTeamClick(team.id)}
                          >
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
    </div>
  )
}
