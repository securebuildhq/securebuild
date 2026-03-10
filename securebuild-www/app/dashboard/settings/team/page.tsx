"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Team } from "@/lib/types/team"
import { getTeamAction } from "@/lib/team/actions/get-team"
import { setTeamNameAction } from "@/lib/team/actions/set-team-name"
import { useSession } from "@/app/hooks/use-session"

export default function TeamOverviewPage() {
  const { session } = useSession()
  const [team, setTeam] = useState<Team | null>(null)
  const [pendingTeamName, setPendingTeamName] = useState(team?.name)
  const [pendingRegistryUsername, setPendingRegistryUsername] = useState(team?.registryUsername)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!session) {
      return;
    }

    const fetchTeam = async () => {
      const team = await getTeamAction(session)
      setTeam(team)
      setPendingTeamName(team.name)
      setPendingRegistryUsername(team.registryUsername)
    }
    fetchTeam()
  }, [session])

  const handleSave = async () => {
    if (!session || !pendingTeamName?.trim()) {
      return;
    }

    setIsSaving(true);
    try {
      const updatedTeam = await setTeamNameAction(session, pendingTeamName.trim());
      setTeam(updatedTeam);
    } catch (error) {
      console.error('Failed to save team name:', error);
      // Show error message or toast here if desired
    } finally {
      setIsSaving(false);
    }
  }

  if (!team) {
    return <div>Loading...</div>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Overview</CardTitle>
        <CardDescription>Manage your team&apos;s general settings.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="teamName">Team Name</Label>
          <Input
            id="teamName"
            value={pendingTeamName}
            onChange={(e) => setPendingTeamName(e.target.value)}
            placeholder="Enter your team name"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="registryUsername">Registry Username</Label>
          <Input
            id="registryUsername"
            value={pendingRegistryUsername}
            onChange={(e) => setPendingRegistryUsername(e.target.value)}
            placeholder="Enter your registry username"
            readOnly
            className="bg-muted"
          />
        </div>
      </CardContent>
      <CardFooter className="border-t px-6 py-4">
        <Button
          onClick={handleSave}
          disabled={team.name === pendingTeamName || !pendingTeamName?.trim() || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </CardFooter>
    </Card>
  )
}
