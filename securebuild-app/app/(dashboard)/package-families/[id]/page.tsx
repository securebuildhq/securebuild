"use client"

import { useState, useEffect } from "react"
import { useSession } from "@/app/hooks/use-session"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"

import { getPackageFamilyAction } from "@/lib/packagefamily/actions/get-package-family"
import { updatePackageFamilyAction } from "@/lib/packagefamily/actions/update-package-family"
import { deletePackageFamilyAction } from "@/lib/packagefamily/actions/delete-package-family"
import { triggerPackageFamilyUpdateCheckAction } from "@/lib/packagefamily/actions/trigger-update-check"
import { getUpstreamConfigAction } from "@/lib/packagefamily/actions/get-upstream-config"
import { PackageFamilyWithPackages } from "@/lib/types/packagefamily"
import { UpstreamConfig } from "@/lib/packagefamily/packagefamily"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Save, Trash2, Loader2, Edit, X, RefreshCw, GitBranch } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export default function PackageFamilyDetailsPage() {
  const { session, isSessionLoading } = useSession()
  const router = useRouter()
  const params = useParams()
  const familyId = params.id as string

  const [packageFamily, setPackageFamily] = useState<PackageFamilyWithPackages | null>(null)
  const [upstreamConfig, setUpstreamConfig] = useState<UpstreamConfig | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: "",
    versionPattern: "",
    packageNameTemplate: "",
    imageTagTemplate: "",
    monitoringEnabled: false,
    checkFrequencyMinutes: 360,
    dryRunMode: false,
    notifyOnDetection: false,
    notifyOnBuildFailure: true,
    melangeFilePath: "",
    gitRemote: "",
    initialTag: "",
  })
  const [linkGitRepo, setLinkGitRepo] = useState(false)

  // Computed automation mode based on monitoring and dry run fields
  const automationMode: 'disabled' | 'dry-run' | 'enabled' =
    !editForm.monitoringEnabled ? 'disabled' :
    editForm.dryRunMode ? 'dry-run' : 'enabled'

  // Handler to update automation mode and sync the boolean fields
  const setAutomationMode = (mode: 'disabled' | 'dry-run' | 'enabled') => {
    setEditForm({
      ...editForm,
      monitoringEnabled: mode !== 'disabled',
      dryRunMode: mode === 'dry-run',
    })
  }

  const fetchPackageFamily = async () => {
    if (!session) return

    try {
      const data = await getPackageFamilyAction(familyId)
      setPackageFamily(data || null)
      if (data) {
        setEditForm({
          name: data.name,
          versionPattern: data.versionPattern,
          packageNameTemplate: data.packageNameTemplate,
          imageTagTemplate: data.imageTagTemplate || "",
          monitoringEnabled: data.monitoringEnabled,
          checkFrequencyMinutes: data.checkFrequencyMinutes,
          dryRunMode: data.dryRunMode,
          notifyOnDetection: data.notifyOnDetection,
          notifyOnBuildFailure: data.notifyOnBuildFailure,
          melangeFilePath: data.melangeFilePath || "",
          gitRemote: data.gitRemote || "",
          initialTag: data.initialTag || "",
        })
        setLinkGitRepo(!!data.gitRemote)

        // Fetch upstream config from latest package version
        try {
          const config = await getUpstreamConfigAction(familyId)
          setUpstreamConfig(config)
        } catch (err) {
          console.error("Failed to fetch upstream config:", err)
          // Non-fatal - just means there are no packages yet
        }
      }
    } catch (err) {
      console.error("Failed to fetch package family:", err)
      setError("Failed to load package family")
    }
  }

  useEffect(() => {
    if (!session) return
    fetchPackageFamily()
  }, [session, familyId])

  // Auto-refresh linked packages table every 5 seconds
  useEffect(() => {
    if (!session || isEditing) return

    const refreshInterval = setInterval(async () => {
      try {
        const data = await getPackageFamilyAction(familyId)
        // Update state only if we have data, regardless of changes
        // This ensures we stay in sync with the server
        if (data) {
          setPackageFamily(data)
        }
      } catch (err) {
        console.error("Failed to refresh package family:", err)
      }
    }, 5000)

    return () => clearInterval(refreshInterval)
  }, [session, familyId, isEditing])

  const handleSave = async () => {
    if (!session || !packageFamily) return

    setIsSaving(true)
    setError(null)

    try {
      const updated = await updatePackageFamilyAction(familyId, {
        name: editForm.name.trim(),
        versionPattern: editForm.versionPattern,
        packageNameTemplate: editForm.packageNameTemplate,
        imageTagTemplate: editForm.imageTagTemplate,
        monitoringEnabled: editForm.monitoringEnabled,
        checkFrequencyMinutes: editForm.checkFrequencyMinutes,
        dryRunMode: editForm.dryRunMode,
        notifyOnDetection: editForm.notifyOnDetection,
        notifyOnBuildFailure: editForm.notifyOnBuildFailure,
        gitRemote: linkGitRepo ? editForm.gitRemote.trim() : "",
        melangeFilePath: linkGitRepo ? editForm.melangeFilePath.trim() : "",
        initialTag: linkGitRepo ? editForm.initialTag.trim() : "",
      })

      if (updated) {
        setPackageFamily({ ...updated, packages: packageFamily.packages })
        setIsEditing(false)
      }
    } catch (err) {
      console.error("Failed to update package family:", err)
      setError("Failed to update package family")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!session) return

    setIsDeleting(true)
    try {
      await deletePackageFamilyAction(familyId)
      router.push("/package-families")
    } catch (err) {
      console.error("Failed to delete package family:", err)
      setError("Failed to delete package family")
      setIsDeleting(false)
    }
  }

  const handleCancel = () => {
    if (packageFamily) {
      setEditForm({
        name: packageFamily.name,
        versionPattern: packageFamily.versionPattern,
        packageNameTemplate: packageFamily.packageNameTemplate,
        imageTagTemplate: packageFamily.imageTagTemplate || "",
        monitoringEnabled: packageFamily.monitoringEnabled,
        checkFrequencyMinutes: packageFamily.checkFrequencyMinutes,
        dryRunMode: packageFamily.dryRunMode,
        notifyOnDetection: packageFamily.notifyOnDetection,
        notifyOnBuildFailure: packageFamily.notifyOnBuildFailure,
        melangeFilePath: packageFamily.melangeFilePath || "",
        gitRemote: packageFamily.gitRemote || "",
        initialTag: packageFamily.initialTag || "",
      })
      setLinkGitRepo(!!packageFamily.gitRemote)
    }
    setIsEditing(false)
    setError(null)
  }

  const handleCheckForUpdates = async () => {
    if (!session || !packageFamily) return

    setIsCheckingForUpdates(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const result = await triggerPackageFamilyUpdateCheckAction(familyId)

      if (result.success) {
        setSuccessMessage(result.message)
        // Clear success message and reload package family data after 5 seconds
        setTimeout(async () => {
          setSuccessMessage(null)

          // Reload package family to refresh linked packages
          try {
            const data = await getPackageFamilyAction(familyId)
            if (data) {
              setPackageFamily(data)
            }
          } catch (err) {
            console.error("Failed to refresh package family:", err)
          }
        }, 5000)
      } else {
        setError(result.message)
      }
    } catch (err) {
      console.error("Failed to trigger update check:", err)
      setError("Failed to trigger update check")
    } finally {
      setIsCheckingForUpdates(false)
    }
  }

  if (isSessionLoading || !session) {
    return <div>Loading...</div>
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-center py-8">
          <p className="text-red-600 dark:text-red-400">{error}</p>
          <Button className="mt-4" onClick={() => router.push("/package-families")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Package Families
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.push("/package-families")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Package Families
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{packageFamily?.name || "Package Family"}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing ? (
            <>
              <Button variant="outline" onClick={() => setIsEditing(true)} disabled={!packageFamily}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" disabled={!packageFamily}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Package Family</DialogTitle>
                    <DialogDescription>
                      Are you sure you want to delete this package family{packageFamily ? ` "${packageFamily.name}"` : ""}?
                      This will unlink all associated packages but not delete the packages themselves.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      variant="destructive" 
                      onClick={handleDelete}
                      disabled={isDeleting}
                    >
                      {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Delete
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleCancel}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Save Changes
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
          <p className="text-green-600 dark:text-green-400">{successMessage}</p>
        </div>
      )}

      {upstreamConfig && (
        <div className="mb-4 flex gap-6 text-sm">
          <div>
            <span className="text-slate-600 dark:text-slate-400">
              {upstreamConfig.upstreamType === 'github' ? 'GitHub: ' : 'Release Monitor: '}
            </span>
            {upstreamConfig.upstreamType === 'github' ? (
              <a
                href={`https://github.com/${upstreamConfig.upstreamIdentifier}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
              >
                {upstreamConfig.upstreamIdentifier}
              </a>
            ) : (
              <a
                href={`https://release-monitoring.org/project/${upstreamConfig.upstreamIdentifier}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
              >
                {upstreamConfig.upstreamIdentifier}
              </a>
            )}
          </div>
          {upstreamConfig.upstreamType === 'github' && upstreamConfig.useTags !== undefined && (
            <div>
              <span className="text-slate-600 dark:text-slate-400">Version Source: </span>
              <span>{upstreamConfig.useTags ? "Tags" : "Releases"}</span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isEditing ? (
                <>
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Version Pattern</Label>
                    <Input
                      value={editForm.versionPattern}
                      onChange={(e) => setEditForm({ ...editForm, versionPattern: e.target.value })}
                      placeholder="^(\\d+)\\.(\\d+)(?:\\.(\\d+))?$"
                    />
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Regex with at least 2 capture groups for major and minor versions. Patch version is optional.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Package Name Template</Label>
                    <Input
                      value={editForm.packageNameTemplate}
                      onChange={(e) => setEditForm({ ...editForm, packageNameTemplate: e.target.value })}
                    />
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Template for package names using {"{name}"}, {"{major}"}, and {"{minor}"} variables.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Image Tag Template</Label>
                    <Input
                      value={editForm.imageTagTemplate}
                      onChange={(e) => setEditForm({ ...editForm, imageTagTemplate: e.target.value })}
                      placeholder="{major}.{minor}.{patch}"
                    />
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Optional template for image tags using {"{major}"}, {"{minor}"}, and {"{patch}"} variables.
                      If not set, uses the full version as the tag.
                    </p>
                  </div>
                  <div className="space-y-4 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-4 w-4 text-blue-500" />
                        <Label>Link to Git Repository</Label>
                      </div>
                      <Switch
                        checked={linkGitRepo}
                        onCheckedChange={setLinkGitRepo}
                      />
                    </div>
                    {linkGitRepo && (
                      <div className="space-y-4 pl-6 border-l-2 border-blue-100 dark:border-blue-900">
                        <div className="space-y-2">
                          <Label>Git Origin URL</Label>
                          <Input
                            value={editForm.gitRemote}
                            onChange={(e) => setEditForm({ ...editForm, gitRemote: e.target.value })}
                            placeholder="e.g., https://github.com/owner/repo.git"
                          />
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            Public git repository URL where the melange spec is maintained.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label>Path to Spec File</Label>
                          <Input
                            value={editForm.melangeFilePath}
                            onChange={(e) => setEditForm({ ...editForm, melangeFilePath: e.target.value })}
                            placeholder="e.g., melange.yaml"
                          />
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            Path to the melange YAML file relative to the repository root.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label>Initial Tag</Label>
                          <Input
                            value={editForm.initialTag}
                            onChange={(e) => setEditForm({ ...editForm, initialTag: e.target.value })}
                            placeholder="e.g., v1.2.3"
                          />
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            Git tag to use as the starting point. Only tags at or newer than this will be processed. Must be a valid semver tag.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label className="text-sm font-medium">Version Pattern</Label>
                    <p className="text-sm font-mono">{packageFamily?.versionPattern || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Package Name Template</Label>
                    <p className="text-sm font-mono">{packageFamily?.packageNameTemplate || "-"}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Image Tag Template</Label>
                    <p className="text-sm font-mono">{packageFamily?.imageTagTemplate || "-"}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Status & Options</CardTitle>
                {!isEditing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckForUpdates}
                    disabled={isCheckingForUpdates}
                  >
                    {isCheckingForUpdates ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Check Now
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isEditing ? (
                <>
                  <div className="space-y-2">
                    <Label>Automation Mode</Label>
                    <Select value={automationMode} onValueChange={(value) => setAutomationMode(value as 'disabled' | 'dry-run' | 'enabled')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="disabled">Disabled</SelectItem>
                        <SelectItem value="dry-run">Dry Run</SelectItem>
                        <SelectItem value="enabled">Enabled</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                      {automationMode === 'disabled' && "No monitoring - family is inactive"}
                      {automationMode === 'dry-run' && "Monitor and log detected versions but don't create packages"}
                      {automationMode === 'enabled' && "Monitor and automatically create packages for new versions"}
                    </div>
                  </div>

                  {automationMode !== 'disabled' && (
                    <div className="space-y-2">
                      <Label>Check Frequency</Label>
                      <Select value={editForm.checkFrequencyMinutes.toString()} onValueChange={(value) => setEditForm({ ...editForm, checkFrequencyMinutes: parseInt(value) })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="60">1 hour</SelectItem>
                          <SelectItem value="180">3 hours</SelectItem>
                          <SelectItem value="360">6 hours</SelectItem>
                          <SelectItem value="720">12 hours</SelectItem>
                          <SelectItem value="1440">24 hours</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <Label className="text-sm font-medium">Automation Mode</Label>
                    <Badge variant={
                      !packageFamily?.monitoringEnabled ? "secondary" :
                      packageFamily?.dryRunMode ? "outline" : "default"
                    }>
                      {!packageFamily?.monitoringEnabled ? "Disabled" :
                       packageFamily?.dryRunMode ? "Dry Run" : "Enabled"}
                    </Badge>
                  </div>
                  {packageFamily?.monitoringEnabled && (
                    <div className="flex justify-between">
                      <Label className="text-sm font-medium">Check Frequency</Label>
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {packageFamily?.checkFrequencyMinutes === 60 ? "1 hour" :
                         packageFamily?.checkFrequencyMinutes === 180 ? "3 hours" :
                         packageFamily?.checkFrequencyMinutes === 360 ? "6 hours" :
                         packageFamily?.checkFrequencyMinutes === 720 ? "12 hours" :
                         packageFamily?.checkFrequencyMinutes === 1440 ? "24 hours" :
                         packageFamily?.checkFrequencyMinutes ? `${packageFamily.checkFrequencyMinutes} minutes` : "-"}
                      </span>
                    </div>
                  )}
                  {packageFamily?.lastCheckAt && (
                    <div>
                      <Label className="text-sm font-medium">Last Check</Label>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        {new Date(packageFamily.lastCheckAt).toLocaleString()}
                      </p>
                    </div>
                  )}
                  {packageFamily?.lastError && (
                    <div>
                      <Label className="text-sm font-medium">Last Error</Label>
                      <p className="text-sm text-red-600 dark:text-red-400">{packageFamily.lastError}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {packageFamily?.gitRemote && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <GitBranch className="h-5 w-5 text-blue-500" />
                  <CardTitle>Git Repository</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm font-medium">Git Remote</Label>
                  <p className="text-sm font-mono">{packageFamily.gitRemote}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Melange File Path</Label>
                  <p className="text-sm font-mono">{packageFamily.melangeFilePath || "-"}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Initial Tag</Label>
                  <p className="text-sm font-mono">{packageFamily.initialTag || "-"}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Linked Packages ({packageFamily?.packages?.length || 0})</CardTitle>
              <CardDescription>
                Packages that belong to this family
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!packageFamily?.packages?.length ? (
                <div className="text-center py-8">
                  <p className="text-slate-600 dark:text-slate-400">No packages linked to this family</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Package Name</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Last Build</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {packageFamily.packages.map((pkg) => (
                      <TableRow key={pkg.packageId}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/packages/${pkg.packageId}`}
                            className="text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {pkg.packageName}
                          </Link>
                        </TableCell>
                        <TableCell>{pkg.version}</TableCell>
                        <TableCell>
                          {pkg.lastExecutionId ? (
                            <Link
                              href={`/executions/${pkg.lastExecutionId}`}
                              className="inline-block"
                            >
                              <div className={`w-3 h-3 rounded-full cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-sm ${
                                pkg.lastExecutionStatus === 'success' ? 'bg-green-500 hover:bg-green-600' :
                                pkg.lastExecutionStatus === 'failed' ? 'bg-red-500 hover:bg-red-600' :
                                pkg.lastExecutionStatus === 'timed_out' ? 'bg-orange-500 hover:bg-orange-600' :
                                ['building', 'publishing'].includes(pkg.lastExecutionStatus || '') ? 'bg-blue-500 animate-pulse hover:bg-blue-600' :
                                'bg-gray-400 hover:bg-gray-500'
                              }`}
                              title={`${pkg.lastExecutionStatus} - Click to view execution details`}
                              />
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">No builds</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}