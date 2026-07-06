"use client"

import { useState, use, useEffect, createContext, useContext } from "react"
import { useRouter, usePathname, useParams } from "next/navigation"
import { useSession } from "@/app/hooks/use-session"
import { getPackageDataAction } from "@/lib/package/actions/get-package-data"
import { getPackageVersionByReleaseAction } from "@/lib/package/actions/get-package-version-by-release"
import { createPackageVersionAction } from "@/lib/package/actions/create-package-version"
import { createPackageReleaseAction } from "@/lib/package/actions/create-package-release"
import { deletePackageReleaseAction } from "@/lib/package/actions/delete-package-release"
import { updatePackageAction } from "@/lib/package/actions/update-package"
import { listExecutionsAction } from "@/lib/execution/actions/list-executions"
import { ExecutionFilters } from "@/lib/execution/execution"
import { buildPackageVersionAction } from "@/lib/package/actions/build-package"
import { buildPackageChainAction } from "@/lib/package/actions/build-package-chain"
import { setDeleteProtectionAction } from "@/lib/package/actions/set-delete-protection"
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import Link from "next/link"

import { ArrowLeft, Play, Trash2 } from "lucide-react"
import { TriggerPackageModal } from "@/components/trigger-package-modal"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sortVersionInfos } from '@/lib/utils/version-sort'

interface Execution {
  id: string
  packageId: string
  packageName: string
  status: string
  createdAt: string
  completedAt: string | null
  version?: string
  apkRelease?: number | null
  commit?: string
  cause?: string
  causeId?: string
  x86_64BuildStartedAt: string | null
  x86_64BuildFinishedAt: string | null
  aarch64BuildStartedAt: string | null
  aarch64BuildFinishedAt: string | null
  useRoot: boolean | null
  bootstrapEnabled: boolean | null
  bootstrapApkRepository: string | null
  bootstrapKeyringAppend: string | null
}

const defaultMelangeYaml = ``

const PackageContext = createContext<any>(null)
export const usePackageContext = () => useContext(PackageContext)

export function PackageProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { session, isSessionLoading } = useSession()
  const user = session?.user
  const [pkg, setPkg] = useState<any>(null)
  const [executions, setExecutions] = useState<Execution[]>([])
  const [executionsLoading, setExecutionsLoading] = useState(false)
  const [melangeYaml, setMelangeYaml] = useState(defaultMelangeYaml)
  const [selectedVersion, setSelectedVersion] = useState<string>("")
  const [selectedVersionData, setSelectedVersionData] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [packageError, setPackageError] = useState<string | null>(null)
  const [triggerModalOpen, setTriggerModalOpen] = useState(false)
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [isCreatingVersion, setIsCreatingVersion] = useState(false)
  const [isCreatingRelease, setIsCreatingRelease] = useState(false)
  const [originalMelangeYaml, setOriginalMelangeYaml] = useState<string>("")
  const [errorModalOpen, setErrorModalOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>("")
  const [versionLabelModalOpen, setVersionLabelModalOpen] = useState(false)
  const [versionLabelInput, setVersionLabelInput] = useState("")
  const [successModalOpen, setSuccessModalOpen] = useState(false)
  const [successMessage, setSuccessMessage] = useState("")
  const [useRoot, setUseRoot] = useState<boolean>(false)
  const [bootstrapEnabled, setBootstrapEnabled] = useState<boolean>(false)
  const [bootstrapApkRepository, setBootstrapApkRepository] = useState<string>("")
  const [bootstrapKeyringAppend, setBootstrapKeyringAppend] = useState<string>("")
  const [customDiskSize, setCustomDiskSize] = useState<string>("")
  const [isBuildingPackageChain, setIsBuildingPackageChain] = useState(false)
  const [isSavingAndBuilding, setIsSavingAndBuilding] = useState(false)
  const [deleteConfirmModalOpen, setDeleteConfirmModalOpen] = useState(false)
  const [isDeletingVersion, setIsDeletingVersion] = useState(false)

  const params = useParams()
  const id = params.id as string

  const pathname = usePathname()
  const pathSegments = pathname.split('/')
  const activeTab = pathSegments[3] || 'configuration'

  const createVersionKey = (version: string, apkRelease: number) => `${version}-r${apkRelease}`

  const parseVersionKey = (key: string): { version: string; apkRelease: number } | null => {
    const match = key.match(/^(.+)-r(\d+)$/)
    if (match) {
      return { version: match[1], apkRelease: parseInt(match[2]) }
    }
    return null
  }



  const transformExecutions = (packageExecutions: any[]): Execution[] => {
    return packageExecutions.map((exec) => ({
      id: exec.id,
      packageId: exec.packageId,
      packageName: exec.packageName,
      status: exec.status,
      createdAt: exec.createdAt,
      completedAt: null,
      version: exec.versionLabel,
      apkRelease: exec.apkRelease,
      cause: exec.cause,
      causeId: exec.causeId,
      x86_64BuildStartedAt: exec.x86_64BuildStartedAt,
      x86_64BuildFinishedAt: exec.x86_64BuildFinishedAt,
      aarch64BuildStartedAt: exec.aarch64BuildStartedAt,
      aarch64BuildFinishedAt: exec.aarch64BuildFinishedAt,
      useRoot: exec.useRoot,
      bootstrapEnabled: exec.bootstrapEnabled,
      bootstrapApkRepository: exec.bootstrapApkRepository,
      bootstrapKeyringAppend: exec.bootstrapKeyringAppend
    }))
  }

  useEffect(() => {
    if (!session || !id) {
      setLoading(false)
      return
    }
    setLoading(true)
    setPackageError(null)
    getPackageDataAction(session, id)
      .then(({ pkg, selectedVersionData }) => {
        setPkg(pkg)
        setSelectedVersionData(selectedVersionData)
        if (pkg.versionInfos && pkg.versionInfos.length > 0) {
          const sortedVersions = sortVersionInfos(pkg.versionInfos)
          const latestVersion = sortedVersions[sortedVersions.length - 1]
          setSelectedVersion(createVersionKey(latestVersion.version, latestVersion.apkRelease))
        } else if (pkg.lastVersion && pkg.lastAPKRelease !== undefined) {
          setSelectedVersion(createVersionKey(pkg.lastVersion, pkg.lastAPKRelease))
        }
      })
      .catch((error: Error) => {
        console.error("Failed to load package:", error)
        setPackageError("Package not found or failed to load")
      })
      .finally(() => setLoading(false))
  }, [session, id])

  useEffect(() => {
    if (!session || !pkg || !selectedVersion) return

    const versionInfo = parseVersionKey(selectedVersion)
    if (!versionInfo) return

    getPackageVersionByReleaseAction(session, pkg.id, versionInfo.version, versionInfo.apkRelease)
      .then((ver) => {
        const yamlContent = ver.melangeYaml || ""
        const useRoot = ver.useRoot || false
        const bootstrapEnabled = ver.bootstrapEnabled || false
        const bootstrapApkRepository = ver.bootstrapApkRepository || ""
        const bootstrapKeyringAppend = ver.bootstrapKeyringAppend || ""
        const customDiskSize = ver.customDiskSize ? String(ver.customDiskSize) : ""
        setSelectedVersionData(ver)
        setMelangeYaml(yamlContent)
        setOriginalMelangeYaml(yamlContent)
        setUseRoot(useRoot)
        setBootstrapEnabled(bootstrapEnabled)
        setBootstrapApkRepository(bootstrapApkRepository)
        setBootstrapKeyringAppend(bootstrapKeyringAppend)
        setCustomDiskSize(customDiskSize)
      })
      .catch(() => {
        setSelectedVersionData(null)
        setMelangeYaml("")
        setOriginalMelangeYaml("")
        setUseRoot(false)
        setBootstrapEnabled(false)
        setBootstrapApkRepository("")
        setBootstrapKeyringAppend("")
        setCustomDiskSize("")
      })
  }, [session, pkg, selectedVersion])

  useEffect(() => {
    if (!session || !pkg) return

    setExecutionsLoading(true)

    const filters: ExecutionFilters = {
      packageId: pkg.id,
      limit: 20
    }

    listExecutionsAction(session, filters)
      .then(({ executions: packageExecutions }) => {
        const transformedExecutions: Execution[] = transformExecutions(packageExecutions)
        setExecutions(transformedExecutions)
      })
      .catch((error) => {
        console.error("Failed to fetch executions:", error)
        setExecutions([])
      })
      .finally(() => {
        setExecutionsLoading(false)
      })
  }, [session, pkg])

  useEffect(() => {
    if (!session || !pkg) return

    const hasActiveBuilds = executions.some(execution => {
      const status = execution.status.toLowerCase()
      return status === 'building' || status === 'testing' || status === 'publishing' || status === 'queued' || status === 'pending'
    })

    if (!hasActiveBuilds) return

    const interval = setInterval(() => {
      const filters: ExecutionFilters = {
        packageId: pkg.id,
        limit: 20
      }

      listExecutionsAction(session, filters)
        .then(({ executions: packageExecutions }) => {
          const transformedExecutions: Execution[] = transformExecutions(packageExecutions)
          setExecutions(transformedExecutions)
        })
        .catch((error) => {
          console.error("Auto-refresh executions failed:", error)
        })
    }, 10000)

    return () => clearInterval(interval)
  }, [session, pkg, executions])

  const handleBuildPackageChain = async () => {
    if (!session) return
    setIsBuildingPackageChain(true)
    try {
      await buildPackageChainAction(session, pkg.id)
      setSuccessMessage("Package chain build triggered successfully!")
      setSuccessModalOpen(true)
      // Refresh package data
      const { pkg: updatedPkg } = await getPackageDataAction(session, pkg.id)
      setPkg(updatedPkg)
    } catch (error) {
      console.error("Error building package chain:", error)
      setErrorMessage(`Error: ${error instanceof Error ? error.message : "An unknown error occurred"}`)
      setErrorModalOpen(true)
    } finally {
      setIsBuildingPackageChain(false)
    }
  }

  const handleExecuteTrigger = (opts: { refType: "tag" | "release" | "commit"; refValue: string; versionLabel: string; archs: string[]; publish: boolean; }) => {
    if (!pkg) return
    console.log("Triggering package:", pkg.name, opts)
  }

  const handleSaveConfiguration = async () => {
    if (!session || !pkg) return
    setIsSavingConfig(true)
    try {
      if (!selectedVersion) {
        setErrorMessage("Please select a version to update.")
        setErrorModalOpen(true)
        return
      }

      const versionInfo = parseVersionKey(selectedVersion)
      if (!versionInfo) {
        setErrorMessage("Invalid version format.")
        setErrorModalOpen(true)
        return
      }

      const opts = {
        ...(melangeYaml !== originalMelangeYaml && { melangeYaml }),
        useRoot,
        bootstrapEnabled,
        bootstrapApkRepository: bootstrapApkRepository.trim() || null,
        bootstrapKeyringAppend: bootstrapKeyringAppend.trim() || null,
        customDiskSize: customDiskSize.trim() ? parseInt(customDiskSize.trim()) : null
      }

      const result = await updatePackageAction(session, pkg.id, versionInfo.version, versionInfo.apkRelease, opts)

      if ('isFailed' in result && result.isFailed) {
        setErrorMessage(result.message)
        setErrorModalOpen(true)
        return
      }
      setSuccessMessage("Configuration saved successfully!")
      setSuccessModalOpen(true)

      getPackageDataAction(session, pkg.id).then(({ pkg }) => setPkg(pkg))
    } catch (error) {
      console.error("Error saving configuration:", error)
      setErrorMessage(`Error: ${error instanceof Error ? error.message : "An unknown error occurred"}`)
      setErrorModalOpen(true)
    } finally {
      setIsSavingConfig(false)
    }
  }

  const handleSaveAndBuild = async () => {
    if (!session || !pkg) return
    setIsSavingAndBuilding(true)
    try {
      if (!selectedVersion) {
        setErrorMessage("Please select a version to update.")
        setErrorModalOpen(true)
        return
      }

      const versionInfo = parseVersionKey(selectedVersion)
      if (!versionInfo) {
        setErrorMessage("Invalid version format.")
        setErrorModalOpen(true)
        return
      }

      const opts = {
        ...(melangeYaml !== originalMelangeYaml && { melangeYaml }),
        useRoot,
        bootstrapEnabled,
        bootstrapApkRepository: bootstrapApkRepository.trim() || null,
        bootstrapKeyringAppend: bootstrapKeyringAppend.trim() || null,
        customDiskSize: customDiskSize.trim() ? parseInt(customDiskSize.trim()) : null
      }

      // First save the configuration
      const result = await updatePackageAction(session, pkg.id, versionInfo.version, versionInfo.apkRelease, opts)

      if ('isFailed' in result && result.isFailed) {
        setErrorMessage(result.message)
        setErrorModalOpen(true)
        return
      }

      // Update package state
      const { pkg: updatedPkg } = await getPackageDataAction(session, pkg.id)
      setPkg(updatedPkg)

      // Then trigger the build for the specific version
      await buildPackageVersionAction(session, pkg.id, versionInfo.version, versionInfo.apkRelease)

      setSuccessMessage("Configuration saved and build triggered successfully!")
      setSuccessModalOpen(true)

      // Refresh executions to show the new build
      const refreshExecutions = async (retries = 5, delay = 1000) => {
        const filters: ExecutionFilters = {
          packageId: pkg.id,
          limit: 20
        }

        try {
          const { executions: packageExecutions } = await listExecutionsAction(session, filters)
          const transformedExecutions: Execution[] = transformExecutions(packageExecutions)
          setExecutions(transformedExecutions)
        } catch (error) {
          console.error("Failed to refresh executions after save and build:", error)
          if (retries > 0) {
            setTimeout(() => refreshExecutions(retries - 1, delay), delay)
          }
        }
      }

      // Start the refresh with a 1 second delay
      setTimeout(() => refreshExecutions(), 1000)

    } catch (error) {
      console.error("Error saving and building:", error)
      setErrorMessage(`Error: ${error instanceof Error ? error.message : "An unknown error occurred"}`)
      setErrorModalOpen(true)
    } finally {
      setIsSavingAndBuilding(false)
    }
  }

  const handleBuildLinked = async () => {
    if (!session || !pkg) return
    setIsSavingAndBuilding(true)
    try {
      if (!selectedVersion) {
        setErrorMessage("Please select a version to build.")
        setErrorModalOpen(true)
        return
      }

      const versionInfo = parseVersionKey(selectedVersion)
      if (!versionInfo) {
        setErrorMessage("Invalid version format.")
        setErrorModalOpen(true)
        return
      }

      // Trigger the build without saving (linked versions are read-only)
      await buildPackageVersionAction(session, pkg.id, versionInfo.version, versionInfo.apkRelease)

      setSuccessMessage("Build triggered successfully!")
      setSuccessModalOpen(true)

      // Refresh executions to show the new build
      const refreshExecutions = async (retries = 5, delay = 1000) => {
        const filters: ExecutionFilters = {
          packageId: pkg.id,
          limit: 20
        }

        try {
          const { executions: packageExecutions } = await listExecutionsAction(session, filters)
          const transformedExecutions: Execution[] = transformExecutions(packageExecutions)
          setExecutions(transformedExecutions)
        } catch (error) {
          console.error("Failed to refresh executions after build:", error)
          if (retries > 0) {
            setTimeout(() => refreshExecutions(retries - 1, delay), delay)
          }
        }
      }

      setTimeout(() => refreshExecutions(), 1000)

    } catch (error) {
      console.error("Error building linked package:", error)
      setErrorMessage(`Error: ${error instanceof Error ? error.message : "An unknown error occurred"}`)
      setErrorModalOpen(true)
    } finally {
      setIsSavingAndBuilding(false)
    }
  }

  const handleSetDeleteProtection = async (isDeleteProtectionEnabled: boolean) => {
    if (!session || !pkg) return
    try {
      const updatedPkg = await setDeleteProtectionAction(session, pkg.id, isDeleteProtectionEnabled)
      setPkg(updatedPkg)
    } catch (error) {
      console.error("Error setting delete protection:", error)
      setErrorMessage(`Error: ${error instanceof Error ? error.message : "An unknown error occurred"}`)
      setErrorModalOpen(true)
    }
  }

  const handleCreateVersion = async () => {
    if (!session || !pkg) return

    let defaultVersion = ""
    if (selectedVersion) {
      const versionInfo = parseVersionKey(selectedVersion)
      if (versionInfo) {
        defaultVersion = versionInfo.version
      }
    }

    setVersionLabelInput(defaultVersion)
    setVersionLabelModalOpen(true)
  }

  const handleVersionLabelSubmit = async () => {
    if (!versionLabelInput.trim()) return
    if (!session || !pkg) return

    setVersionLabelModalOpen(false)
    setIsCreatingVersion(true)

    try {
      const newVersion = await createPackageVersionAction(session, pkg.id, versionLabelInput.trim())
      console.log("Created new version:", newVersion)
      setSuccessMessage("New version created successfully!")
      setSuccessModalOpen(true)
      // Refresh package data to show new version
      const { pkg: updatedPkg } = await getPackageDataAction(session, pkg.id)
      setPkg(updatedPkg)
      // Automatically select the newly created version
      if (newVersion.apkRelease !== undefined) {
        const newVersionKey = createVersionKey(newVersion.version, newVersion.apkRelease)
        setSelectedVersion(newVersionKey)
      }
    } catch (error) {
      console.error("Error creating new version:", error)
      setErrorMessage(`Error creating new version: ${error instanceof Error ? error.message : "An unknown error occurred"}`)
      setErrorModalOpen(true)
    } finally {
      setIsCreatingVersion(false)
      setVersionLabelInput("")
    }
  }

  const handleCreateRelease = async () => {
    if (!session || !pkg || !selectedVersion) return

    // Parse the selected version to get version and release numbers
    const versionInfo = parseVersionKey(selectedVersion)
    if (!versionInfo) {
      setErrorMessage("Invalid version format.")
      setErrorModalOpen(true)
      return
    }

    setIsCreatingRelease(true)
    try {
      // Create new release - archiving happens on the server side
      const newVersion = await createPackageReleaseAction(
        session,
        pkg.id,
        versionInfo.version,
        selectedVersionData?.melangeYaml || ""
      )

      console.log("Created new release:", newVersion)
      setSuccessMessage("New release created successfully!")
      setSuccessModalOpen(true)

      // Get fresh package data after creating the release
      const { pkg: updatedPkg } = await getPackageDataAction(session, pkg.id)
      setPkg(updatedPkg)

      // Automatically select the newly created version
      if (newVersion.apkRelease !== undefined) {
        const newVersionKey = createVersionKey(newVersion.version, newVersion.apkRelease)
        setSelectedVersion(newVersionKey)
      }
    } catch (error) {
      console.error("Error creating new release:", error)
      setErrorMessage(`Error creating new release: ${error instanceof Error ? error.message : "An unknown error occurred"}`)
      setErrorModalOpen(true)
    } finally {
      setIsCreatingRelease(false)
    }
  }

  const handleDeleteVersion = async () => {
    if (!session || !pkg || !selectedVersion) return

    const versionInfo = parseVersionKey(selectedVersion)
    if (!versionInfo) {
      setErrorMessage("Invalid version format.")
      setErrorModalOpen(true)
      return
    }

    // Check if this is the only version
    if (pkg.versionInfos && pkg.versionInfos.length <= 1) {
      setErrorMessage("Cannot delete the last remaining release of a package.")
      setErrorModalOpen(true)
      return
    }

    setDeleteConfirmModalOpen(true)
  }

  const handleConfirmDeleteVersion = async () => {
    if (!session || !pkg || !selectedVersion) return

    const versionInfo = parseVersionKey(selectedVersion)
    if (!versionInfo) return

    setDeleteConfirmModalOpen(false)
    setIsDeletingVersion(true)

    try {
      await deletePackageReleaseAction(session, pkg.id, versionInfo.version, versionInfo.apkRelease)

      setSuccessMessage("Release deleted successfully!")
      setSuccessModalOpen(true)

      // Refresh package data to update the version list
      const { pkg: updatedPkg } = await getPackageDataAction(session, pkg.id)
      setPkg(updatedPkg)

      // Select a different version if the deleted one was selected
      if (updatedPkg.versionInfos && updatedPkg.versionInfos.length > 0) {
        const sortedVersions = sortVersionInfos(updatedPkg.versionInfos)
        const latestVersion = sortedVersions[sortedVersions.length - 1]
        setSelectedVersion(createVersionKey(latestVersion.version, latestVersion.apkRelease))
      } else {
        setSelectedVersion("")
      }

    } catch (error) {
      console.error("Error deleting version:", error)
      setErrorMessage(`Error deleting version: ${error instanceof Error ? error.message : "An unknown error occurred"}`)
      setErrorModalOpen(true)
    } finally {
      setIsDeletingVersion(false)
    }
  }

  const renderVersionSelector = () => {
    const showCreateButtons = activeTab === 'configuration'

    if (!pkg?.versionInfos || pkg.versionInfos.length === 0) {
      if (pkg?.versionLabels && pkg.versionLabels.length > 0) {
        return (
          <div className="mb-4 flex items-center gap-2">
            <Select value={selectedVersion} onValueChange={setSelectedVersion}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select version" />
              </SelectTrigger>
              <SelectContent>
                {pkg.versionLabels.map((label: string) => (
                  <SelectItem key={label} value={label}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showCreateButtons && (
              <>
                <Button onClick={handleCreateVersion} disabled={isCreatingVersion || isCreatingRelease} size="sm" variant="outline" className="min-w-[152px]">
                  {isCreatingVersion ? "Creating..." : "Create New Version"}
                </Button>
                <Button onClick={handleCreateRelease} disabled={isCreatingVersion || isCreatingRelease} size="sm" className="min-w-[152px]">
                  {isCreatingRelease ? "Creating..." : "Create New Release"}
                </Button>
                <Button
                  onClick={handleDeleteVersion}
                  disabled={isDeletingVersion}
                  size="sm"
                  variant="destructive"
                  className="min-w-[144px]"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {isDeletingVersion ? "Deleting..." : "Delete Release"}
                </Button>
              </>
            )}
          </div>
        )
      }
      return (
        <div className="mb-4 flex items-center gap-2">
          {showCreateButtons && (
            <>
              <Button onClick={handleCreateVersion} disabled={isCreatingVersion || isCreatingRelease} size="sm" variant="outline" className="min-w-[152px]">
                {isCreatingVersion ? "Creating..." : "Create New Version"}
              </Button>
              <Button onClick={handleCreateRelease} disabled={isCreatingVersion || isCreatingRelease} size="sm" className="min-w-[152px]">
                {isCreatingRelease ? "Creating..." : "Create New Release"}
              </Button>
              <Button
                onClick={handleDeleteVersion}
                disabled={isDeletingVersion}
                size="sm"
                variant="destructive"
                className="min-w-[144px]"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {isDeletingVersion ? "Deleting..." : "Delete Release"}
              </Button>
            </>
          )}
        </div>
      )
    }

    return (
      <div className="mb-4 flex items-center gap-2">
        <Select value={selectedVersion} onValueChange={setSelectedVersion}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select version" />
          </SelectTrigger>
          <SelectContent>
            {sortVersionInfos(pkg.versionInfos).map((info: any) => {
              const key = createVersionKey(info.version, info.apkRelease)
              return (
                <SelectItem key={key} value={key}>
                  {info.version}-r{info.apkRelease}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        {showCreateButtons && (
          <>
            <Button onClick={handleCreateVersion} disabled={isCreatingVersion || isCreatingRelease} size="sm" variant="outline" className="min-w-[152px]">
              {isCreatingVersion ? "Creating..." : "Create New Version"}
            </Button>
            <Button onClick={handleCreateRelease} disabled={isCreatingVersion || isCreatingRelease} size="sm" className="min-w-[152px]">
              {isCreatingRelease ? "Creating..." : "Create New Release"}
            </Button>
            <Button
              onClick={handleDeleteVersion}
              disabled={isDeletingVersion}
              size="sm"
              variant="destructive"
              className="min-w-[144px]"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {isDeletingVersion ? "Deleting..." : "Delete Release"}
            </Button>
          </>
        )}
      </div>
    )
  }

  const getLastSuccessfulBuildDuration = (): string | null => {
    if (!executions || executions.length === 0) return null;

    // Find the most recent successful execution by sorting by date
    const successfulExecutions = executions
      .filter(execution => execution.status.toLowerCase() === 'success')
      .filter(execution => {
        const createdDate = new Date(execution.createdAt);
        return !isNaN(createdDate.getTime());
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const successfulExecution = successfulExecutions[0];
    if (!successfulExecution) return null;

    // Get the build start times for both architectures, validating dates
    const buildStartTimes = [
      successfulExecution.x86_64BuildStartedAt ? new Date(successfulExecution.x86_64BuildStartedAt) : null,
      successfulExecution.aarch64BuildStartedAt ? new Date(successfulExecution.aarch64BuildStartedAt) : null,
    ].filter((date): date is Date => date !== null && !isNaN(date.getTime()));

    // Get the finish times for both architectures, validating dates
    const finishTimes = [
      successfulExecution.x86_64BuildFinishedAt ? new Date(successfulExecution.x86_64BuildFinishedAt) : null,
      successfulExecution.aarch64BuildFinishedAt ? new Date(successfulExecution.aarch64BuildFinishedAt) : null,
    ].filter((date): date is Date => date !== null && !isNaN(date.getTime()));

    if (buildStartTimes.length === 0 || finishTimes.length === 0) return null;

    // Use the earliest build start time to calculate actual build duration
    const startDate = buildStartTimes.reduce((earliest, current) =>
      current < earliest ? current : earliest
    );

    // Use the latest finish time across architectures
    const endDate = finishTimes.reduce((latest, current) =>
      current > latest ? current : latest
    );

    const durationMs = endDate.getTime() - startDate.getTime();

    // Check for negative duration (indicates data corruption or clock skew)
    if (durationMs < 0) {
      return "Invalid timing data";
    }

    const totalSeconds = Math.floor(durationMs / 1000);
    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
    const seconds = totalSeconds % 60;

    // Format duration based on length
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else {
      return `${minutes}m ${seconds}s`;
    }
  };

  const isLastBuildTimedOut = (): boolean => {
    if (!executions || executions.length === 0) return false;

    // Filter executions with valid createdAt dates and sort by most recent
    const validExecutions = executions
      .filter(execution => {
        const createdDate = new Date(execution.createdAt);
        return !isNaN(createdDate.getTime());
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const mostRecentExecution = validExecutions[0];
    if (!mostRecentExecution) return false;

    return mostRecentExecution.status.toLowerCase() === 'timed_out';
  };

  const getLastSuccessfulBuildSettings = () => {
    if (!executions || executions.length === 0) return null;

    // Find the most recent successful execution
    const successfulExecutions = executions
      .filter(execution => execution.status.toLowerCase() === 'success')
      .filter(execution => {
        const createdDate = new Date(execution.createdAt);
        return !isNaN(createdDate.getTime());
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const successfulExecution = successfulExecutions[0];
    if (!successfulExecution) return null;

    return {
      useRoot: successfulExecution.useRoot,
      bootstrapEnabled: successfulExecution.bootstrapEnabled,
      bootstrapApkRepository: successfulExecution.bootstrapApkRepository,
      bootstrapKeyringAppend: successfulExecution.bootstrapKeyringAppend,
      executedAt: successfulExecution.createdAt
    };
  };

  const isSelectedRevisionImmutable = (): boolean => {
    if (!executions || executions.length === 0 || !selectedVersion) return false;

    const versionInfo = parseVersionKey(selectedVersion);
    if (!versionInfo) return false;

    // Find executions for the selected version/revision
    const disallowedStatuses = ["success", "building", "publishing"];
    const selectedVersionExecutions = executions.filter(execution =>
      execution.version === versionInfo.version &&
      execution.apkRelease === versionInfo.apkRelease &&
      disallowedStatuses.includes(execution.status.toLowerCase())
    );

    return selectedVersionExecutions.length > 0;
  };

  const contextValue = {
    pkg, setPkg, executions, setExecutions, executionsLoading, melangeYaml, setMelangeYaml,
    selectedVersion, setSelectedVersion, selectedVersionData, loading, triggerModalOpen,
    setTriggerModalOpen, isSavingConfig, isCreatingVersion, isCreatingRelease,
    originalMelangeYaml, useRoot, setUseRoot, bootstrapEnabled, setBootstrapEnabled,
    bootstrapApkRepository, setBootstrapApkRepository, bootstrapKeyringAppend, setBootstrapKeyringAppend,
    customDiskSize, setCustomDiskSize, handleSaveConfiguration, handleSaveAndBuild, handleBuildLinked, isSavingAndBuilding, handleCreateVersion, handleCreateRelease,
    handleExecuteTrigger, renderVersionSelector, createVersionKey,
    parseVersionKey, session, user, isSessionLoading, id, activeTab,
    handleSetDeleteProtection, handleBuildPackageChain, isBuildingPackageChain,
    errorModalOpen, setErrorModalOpen, errorMessage,
    versionLabelModalOpen, setVersionLabelModalOpen, versionLabelInput, setVersionLabelInput, handleVersionLabelSubmit,
    successModalOpen, setSuccessModalOpen, successMessage,
    getLastSuccessfulBuildDuration, isLastBuildTimedOut, getLastSuccessfulBuildSettings,
    handleDeleteVersion, deleteConfirmModalOpen, setDeleteConfirmModalOpen, handleConfirmDeleteVersion, isDeletingVersion,
    isSelectedRevisionImmutable
  }

  const basePath = `/packages/${id}`
  const navItems = [
    { name: 'Configuration', tab: 'configuration', href: basePath, visible: true },
    { name: 'Executions', tab: 'executions', href: `${basePath}/executions`, visible: true },
    { name: 'Additional Files', tab: 'additional-files', href: `${basePath}/additional-files`, visible: true }
  ]

  if (isSessionLoading || loading) {
    return <div>Loading...</div>
  }

  // If no session after loading is complete, user will be redirected by useSession hook
  if (!session || !user) {
    return <div>Redirecting to Login page...</div>
  }

  // Handle package loading errors
  if (packageError) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Package Not Found</h1>
          <p className="text-muted-foreground mb-4">{packageError}</p>
          <Link href="/packages">
            <Button variant="outline">Back to Packages</Button>
          </Link>
        </div>
      </div>
    )
  }

  // If package is still loading or not loaded yet
  if (!pkg) {
    return <div>Loading...</div>
  }

  return (
    <PackageContext.Provider value={contextValue}>
      <div className="p-6">
            <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
              <div className="flex items-center gap-4">
                <Link href="/packages">
                  <Button variant="ghost" size="icon">
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                </Link>
                <div>
                  <h1 className="text-3xl font-bold">{pkg.name}</h1>
                  {pkg.parentId && pkg.parentName && (
                    <p className="text-sm text-muted-foreground mb-1">
                      Parent package: <Link href={`/packages/${pkg.parentId}`} className="text-primary hover:underline">{pkg.parentName}</Link>
                    </p>
                  )}
                  <p className="text-muted-foreground">{pkg.description}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleBuildPackageChain}
                  disabled={isBuildingPackageChain}
                  variant="outline"
                >
                  <Play className="mr-2 h-4 w-4" />
                  {isBuildingPackageChain ? "Building..." : "Build Package Chain"}
                </Button>
              </div>
            </div>

            <div className="flex items-center space-x-1 border-b mb-4">
              {navItems.filter(item => item.visible).map(item => (
                <Link key={item.tab} href={item.href} passHref>
                  <Button
                    variant="ghost"
                    className={`pb-4 px-3 rounded-none border-b-2 hover:bg-transparent -mb-px ${
                      activeTab === item.tab
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-primary/80'
                    }`}
                  >
                    {item.name}
                  </Button>
                </Link>
              ))}
            </div>

        {children}

        <TriggerPackageModal
          isOpen={triggerModalOpen}
          onClose={() => setTriggerModalOpen(false)}
          packageName={pkg?.name}
          onTrigger={handleExecuteTrigger}
        />

        <AlertDialog open={errorModalOpen} onOpenChange={setErrorModalOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Error</AlertDialogTitle>
              <AlertDialogDescription>{errorMessage}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setErrorModalOpen(false)}>OK</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={versionLabelModalOpen} onOpenChange={setVersionLabelModalOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Create New Version</AlertDialogTitle>
              <AlertDialogDescription>Enter a version label for the new package version.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-4">
              <Label htmlFor="version-label-input" className="text-sm font-medium">Version Label</Label>
              <Input
                id="version-label-input"
                placeholder="e.g., 1.0.0, v2.1.3, beta-1"
                value={versionLabelInput}
                onChange={(e) => setVersionLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleVersionLabelSubmit()
                }}
                className="mt-2"
                autoFocus
              />
            </div>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => { setVersionLabelModalOpen(false); setVersionLabelInput(""); }}>Cancel</Button>
              <Button onClick={handleVersionLabelSubmit} disabled={!versionLabelInput.trim()}>Create Version</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={successModalOpen} onOpenChange={setSuccessModalOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>✅ Success</AlertDialogTitle>
              <AlertDialogDescription>{successMessage}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setSuccessModalOpen(false)}>OK</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={deleteConfirmModalOpen} onOpenChange={setDeleteConfirmModalOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>⚠️ Confirm Delete</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete release <strong>{selectedVersion}</strong>?
                <br />
                <br />
                This will permanently remove the package release and all subpackage releases, including APKs, configuration, files, patches, dependencies, and all build history.
                <br />
                <br />
                <strong>This action cannot be undone.</strong>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeleteConfirmModalOpen(false)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDeleteVersion} className="bg-red-600 hover:bg-red-700">
                Delete Release
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PackageContext.Provider>
  )
}
