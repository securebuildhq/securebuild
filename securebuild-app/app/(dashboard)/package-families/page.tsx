"use client"

import { useState, useEffect } from "react"
import { useSession } from "@/app/hooks/use-session"
import { useRouter } from "next/navigation"

import { listPackageFamiliesAction } from "@/lib/packagefamily/actions/list-package-families"
import { PackageFamily } from "@/lib/types/packagefamily"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Plus, Search } from "lucide-react"

export default function PackageFamiliesPage() {
  const { session, isSessionLoading } = useSession()
  const user = session?.user
  const router = useRouter()
  const [packageFamilies, setPackageFamilies] = useState<PackageFamily[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    if (!session) return

    const fetchPackageFamilies = async () => {
      try {
        setLoading(true)
        const data = await listPackageFamiliesAction(session)
        setPackageFamilies(data)
      } catch (err) {
        console.error("Failed to fetch package families:", err)
        setError("Failed to load package families")
      } finally {
        setLoading(false)
      }
    }

    fetchPackageFamilies()
  }, [session])

  const handlePackageFamilyClick = (id: string) => {
    router.push(`/package-families/${id}`)
  }

  const handleCreateClick = () => {
    router.push('/package-families/new')
  }

  // Filter package families based on search query
  const filteredPackageFamilies = packageFamilies.filter((family) => {
    if (!searchQuery) return true
    return family.name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  if (isSessionLoading || !session || !user) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Package Families</h1>
        <Button onClick={handleCreateClick}>
          <Plus className="h-4 w-4 mr-2" />
          New Package Family
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Package Families</CardTitle>
          <CardDescription>
            Manage groups of related packages for automatic version detection and builds
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Search Bar */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search package families by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-full md:w-96"
              />
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <p className="text-slate-600 dark:text-slate-400">Loading package families...</p>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
          ) : packageFamilies.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-600 dark:text-slate-400">No package families found</p>
              <Button className="mt-4" onClick={handleCreateClick}>
                <Plus className="h-4 w-4 mr-2" />
                Create your first package family
              </Button>
            </div>
          ) : filteredPackageFamilies.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-600 dark:text-slate-400">No package families match your search</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Monitoring</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Last Check</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPackageFamilies.map((family) => (
                  <TableRow key={family.id}>
                    <TableCell className="font-medium">{family.name}</TableCell>
                    <TableCell>
                      <Badge variant={family.monitoringEnabled ? "default" : "secondary"}>
                        {family.monitoringEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        !family.monitoringEnabled ? "secondary" :
                        family.dryRunMode ? "outline" : "default"
                      }>
                        {!family.monitoringEnabled ? "Disabled" :
                         family.dryRunMode ? "Dry Run" : "Enabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {family.lastCheckAt 
                        ? new Date(family.lastCheckAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                        : "Never"
                      }
                    </TableCell>
                    <TableCell>
                      {family.lastCheckAt && (
                        <div 
                          className={`w-3 h-3 rounded-full ${
                            family.lastError 
                              ? 'bg-red-500 border border-red-600' 
                              : 'bg-green-500 border border-green-600'
                          }`}
                          title={family.lastError ? 
                            `Error: ${family.lastError.slice(0, 100)}${family.lastError.length > 100 ? '...' : ''}`
                            : "Last check successful"}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePackageFamilyClick(family.id)}
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