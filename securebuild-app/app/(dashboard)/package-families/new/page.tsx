"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, Loader2, Search, GitBranch } from "lucide-react"
import { useSession } from "@/app/hooks/use-session"
import { createPackageFamilyAction } from "@/lib/packagefamily/actions/create-package-family"
import { createLinkedPackageFamilyAction } from "@/lib/packagefamily/actions/create-linked-package-family"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatVersion, parseVersion } from "@/lib/types/packagefamily"
import { listAvailablePackagesAction, AvailablePackage } from "@/lib/packagefamily/actions/list-available-packages"
import { getUpstreamConfigFromPackageAction } from "@/lib/packagefamily/actions/get-upstream-config"
import { UpstreamConfig } from "@/lib/packagefamily/packagefamily"

interface SelectedPackage extends AvailablePackage {
  versionMajor: number;
  versionMinor: number;
  isTemplate: boolean;
}

export default function NewPackageFamilyPage() {
  const { session, isSessionLoading } = useSession()
  const router = useRouter()

  const [name, setName] = useState("")
  const [versionPattern, setVersionPattern] = useState("^(\\d+)\\.(\\d+)(?:\\.(\\d+))?$")
  const [packageNameTemplate, setPackageNameTemplate] = useState("{name}-{major}.{minor}")
  const [imageTagTemplate, setImageTagTemplate] = useState("")

  const [automationMode, setAutomationMode] = useState<'disabled' | 'dry-run' | 'enabled'>('disabled')
  
  const [checkFrequencyMinutes, setCheckFrequencyMinutes] = useState(360) // 6 hours
  
  // Regex tester state
  const [testString, setTestString] = useState("")
  const [showRegexTest, setShowRegexTest] = useState(false)
  
  // Package selection state
  const [availablePackages, setAvailablePackages] = useState<AvailablePackage[]>([])
  const [selectedPackages, setSelectedPackages] = useState<SelectedPackage[]>([])
  const [packageSearchTerm, setPackageSearchTerm] = useState("")
  const [packagesLoading, setPackagesLoading] = useState(true)

  // Upstream config from selected package
  const [upstreamConfig, setUpstreamConfig] = useState<UpstreamConfig | null>(null)
  const [upstreamConfigLoading, setUpstreamConfigLoading] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tab state
  const [activeTab, setActiveTab] = useState("select-packages")

  // Linked repository form state
  const [linkedName, setLinkedName] = useState("")
  const [gitRemote, setGitRemote] = useState("")
  const [melangeFilePath, setMelangeFilePath] = useState("")
  const [initialTag, setInitialTag] = useState("")
  const [isSavingLinked, setIsSavingLinked] = useState(false)
  const [linkedError, setLinkedError] = useState<string | null>(null)

  // Load available packages
  useEffect(() => {
    if (!session) return

    const fetchPackages = async () => {
      try {
        setPackagesLoading(true)
        const packages = await listAvailablePackagesAction(session)
        setAvailablePackages(packages)
      } catch (err) {
        console.error("Failed to fetch packages:", err)
        setError("Failed to load packages")
      } finally {
        setPackagesLoading(false)
      }
    }

    fetchPackages()
  }, [session])

  // Fetch upstream config when the template package changes
  useEffect(() => {
    if (!session) return

    const templatePackage = selectedPackages.find(pkg => pkg.isTemplate)
    if (!templatePackage) {
      setUpstreamConfig(null)
      return
    }

    const fetchUpstreamConfig = async () => {
      try {
        setUpstreamConfigLoading(true)
        const config = await getUpstreamConfigFromPackageAction(session, templatePackage.id)
        setUpstreamConfig(config)
      } catch (err) {
        console.error("Failed to fetch upstream config:", err)
        setUpstreamConfig(null)
      } finally {
        setUpstreamConfigLoading(false)
      }
    }

    fetchUpstreamConfig()
  }, [session, selectedPackages])

  const filteredPackages = availablePackages.filter(pkg => {
    // If family name is set, only show packages that start with "<family_name>-"
    if (name.trim()) {
      const familyPrefix = `${name.trim()}-`
      if (!pkg.name.startsWith(familyPrefix)) {
        return false
      }
    }

    // Apply search filter and exclude already selected packages
    return pkg.name.toLowerCase().includes(packageSearchTerm.toLowerCase()) &&
           !selectedPackages.some(selected => selected.id === pkg.id)
  })

  const addPackage = (pkg: AvailablePackage) => {
    // Try to parse version from lastVersion to get major.minor
    const versionMatch = pkg.lastVersion.match(/^(\d+)\.(\d+)/)
    const versionMajor = versionMatch ? parseInt(versionMatch[1]) : 1
    const versionMinor = versionMatch ? parseInt(versionMatch[2]) : 0
    
    // If this is the first package and name is empty, suggest family name
    if (selectedPackages.length === 0 && !name.trim()) {
      // Try to extract base name by removing version pattern (e.g., "package-1.2" -> "package")
      const nameMatch = pkg.name.match(/^(.+?)-\d+\.\d+$/) || pkg.name.match(/^(.+?)-v?\d+\.\d+$/)
      if (nameMatch) {
        setName(nameMatch[1])
      } else {
        // Fallback: just use the package name as-is
        setName(pkg.name)
      }
    }
    
    const selectedPackage: SelectedPackage = {
      ...pkg,
      versionMajor,
      versionMinor,
      isTemplate: selectedPackages.length === 0, // First package becomes template
    }
    
    setSelectedPackages([...selectedPackages, selectedPackage])
  }

  const removePackage = (packageId: string) => {
    const newSelected = selectedPackages.filter(pkg => pkg.id !== packageId)
    
    // If we removed the template and there are still packages, make the first one template
    if (newSelected.length > 0 && !newSelected.some(pkg => pkg.isTemplate)) {
      newSelected[0].isTemplate = true
    }
    
    setSelectedPackages(newSelected)
  }

  const updatePackageVersion = (packageId: string, field: 'versionMajor' | 'versionMinor', value: number) => {
    setSelectedPackages(packages => 
      packages.map(pkg => 
        pkg.id === packageId ? { ...pkg, [field]: value } : pkg
      )
    )
  }

  const setAsTemplate = (packageId: string) => {
    setSelectedPackages(packages =>
      packages.map(pkg => ({
        ...pkg,
        isTemplate: pkg.id === packageId
      }))
    )
  }

  const handleSave = async () => {
    if (!session) return

    if (!name.trim()) {
      setError("Name is required.")
      return
    }

    if (selectedPackages.length === 0) {
      setError("At least one package must be selected.")
      return
    }
    
    setError(null)
    setIsSaving(true)

    try {
      const newFamily = await createPackageFamilyAction(session, {
        name: name.trim(),
        monitoringEnabled: automationMode !== 'disabled',
        checkFrequencyMinutes,
        versionPattern,
        majorVersionFilter: undefined,
        packageNameTemplate,
        imageTagTemplate: imageTagTemplate || undefined,
        dryRunMode: automationMode === 'dry-run',
        minVersion: undefined,
        notifyOnDetection: false,
        notifyOnBuildFailure: true,
      })
      
      router.push(`/package-families/${newFamily.id}`)
    } catch (err) {
      console.error("Failed to create package family:", err)
      setError("Failed to create package family. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    router.push("/package-families")
  }

  const handleLinkedSave = async () => {
    if (!session) return

    if (!linkedName.trim()) {
      setLinkedError("Name is required.")
      return
    }
    if (!gitRemote.trim()) {
      setLinkedError("Git remote is required.")
      return
    }
    if (!melangeFilePath.trim()) {
      setLinkedError("Melange file path is required.")
      return
    }
    if (!initialTag.trim()) {
      setLinkedError("Initial tag is required.")
      return
    }

    setLinkedError(null)
    setIsSavingLinked(true)

    try {
      const newFamily = await createLinkedPackageFamilyAction(session, {
        name: linkedName.trim(),
        gitRemote: gitRemote.trim(),
        melangeFilePath: melangeFilePath.trim(),
        initialTag: initialTag.trim(),
      })
      router.push(`/package-families/${newFamily.id}`)
    } catch (err) {
      console.error("Failed to create linked package family:", err)
      setLinkedError("Failed to create linked package family. Please try again.")
    } finally {
      setIsSavingLinked(false)
    }
  }

  const testRegex = () => {
    if (!versionPattern || !testString) return null
    
    try {
      // Unescape the pattern for testing (remove double backslashes)
      const cleanPattern = versionPattern.replace(/\\\\/g, '\\')
      const regex = new RegExp(cleanPattern)
      const match = regex.exec(testString)
      
      return {
        matches: !!match,
        groups: match ? match.slice(1) : [],
        fullMatch: match ? match[0] : null,
        error: null
      }
    } catch (error) {
      return {
        matches: false,
        groups: [],
        fullMatch: null,
        error: (error as Error).message
      }
    }
  }

  if (isSessionLoading || !session) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={handleCancel}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Package Families
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Create Package Family</h1>
        <p className="text-slate-600 dark:text-slate-400 mt-2">
          Package families automatically create new packages for major/minor version releases. Individual packages already track patch releases (1.2.3 → 1.2.4), but families create entirely new packages when upstream releases new minor or major versions (1.2.x → 1.3.0).
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="select-packages">Select Packages</TabsTrigger>
          <TabsTrigger value="link-repository">
            <GitBranch className="h-4 w-4 mr-2" />
            Link a repository
          </TabsTrigger>
        </TabsList>

        <TabsContent value="select-packages" className="space-y-6">
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-red-600 dark:text-red-400">{error}</p>
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

          <div className="space-y-6">
            {/* Package Selection - First */}
            <Card>
              <CardHeader>
                <CardTitle>Select Packages ({selectedPackages.length} selected)</CardTitle>
                <CardDescription>
                  Choose packages to include in this family. At least one is required. The family name will be suggested based on your first selection.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {packagesLoading ? (
                  <div className="text-center py-8">
                    <p className="text-slate-600 dark:text-slate-400">Loading packages...</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-4 mb-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                        <Input
                          placeholder="Search packages..."
                          value={packageSearchTerm}
                          onChange={(e) => setPackageSearchTerm(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                    </div>

                    {selectedPackages.length > 0 && (
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-medium">Selected Packages:</h4>
                        </div>
                        <div className="space-y-2 max-h-48 overflow-y-auto border rounded p-2">
                          {selectedPackages.map((pkg) => (
                            <div key={pkg.id} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800 rounded">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{pkg.name}</span>
                                  {pkg.isTemplate && (
                                    <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded">
                                      Template
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <Input
                                    type="number"
                                    min={0}
                                    max={99}
                                    value={pkg.versionMajor}
                                    onChange={(e) => updatePackageVersion(pkg.id, 'versionMajor', parseInt(e.target.value) || 0)}
                                    className="w-16 h-7 text-xs"
                                  />
                                  <span className="text-xs">.</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={99}
                                    value={pkg.versionMinor}
                                    onChange={(e) => updatePackageVersion(pkg.id, 'versionMinor', parseInt(e.target.value) || 0)}
                                    className="w-16 h-7 text-xs"
                                  />
                                  {!pkg.isTemplate && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setAsTemplate(pkg.id)}
                                      className="h-7 text-xs"
                                    >
                                      Set as Template
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => removePackage(pkg.id)}
                                className="h-7 w-7 p-0"
                              >
                                ×
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="max-h-64 overflow-y-auto border rounded">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Package Name</TableHead>
                            <TableHead>Version</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredPackages.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center py-4 text-slate-600 dark:text-slate-400">
                                {packageSearchTerm ? "No packages found matching search" : "No packages available"}
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredPackages.slice(0, 20).map((pkg) => (
                              <TableRow key={pkg.id}>
                                <TableCell className="font-medium">{pkg.name}</TableCell>
                                <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                                  {pkg.lastVersion}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => addPackage(pkg)}
                                  >
                                    Add
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Basic Information - Now Second */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Basic Information</CardTitle>
                  <CardDescription>
                    Configure the basic details of your package family
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g., replicated"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      A unique identifier for this package family (auto-suggested from first package)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="packageNameTemplate">Package Name Template</Label>
                    <Input
                      id="packageNameTemplate"
                      placeholder="{name}-{major}.{minor}"
                      value={packageNameTemplate}
                      onChange={(e) => setPackageNameTemplate(e.target.value)}
                    />
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Template for package names using {"{name}"}, {"{major}"}, and {"{minor}"} variables.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="imageTagTemplate">Image Tag Template</Label>
                    <Input
                      id="imageTagTemplate"
                      placeholder="{major}.{minor}.{patch}"
                      value={imageTagTemplate}
                      onChange={(e) => setImageTagTemplate(e.target.value)}
                    />
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Optional template for image tags using {"{major}"}, {"{minor}"}, and {"{patch}"} variables.
                      If not set, uses the full version as the tag.
                    </p>
                  </div>
                  
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Upstream repository configuration will be read from the template package's melange YAML.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Version Detection</CardTitle>
                  <CardDescription>
                    Configure how to detect and extract version numbers from upstream
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Version source (Tags vs Releases) will be read from the template package's melange YAML.
                  </p>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="versionPattern">Version Pattern</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowRegexTest(!showRegexTest)}
                      >
                        {showRegexTest ? "Hide Tester" : "Test Pattern"}
                      </Button>
                    </div>
                    <Input
                      id="versionPattern"
                      value={versionPattern}
                      onChange={(e) => setVersionPattern(e.target.value)}
                      placeholder="^(\d+)\.(\d+)(?:\.(\d+))?$"
                    />
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Regex pattern to extract version numbers. Must have at least 2 capture groups for major and minor versions. Patch version is optional.
                    </p>

                    {showRegexTest && (
                      <div className="border rounded p-3 bg-slate-50 dark:bg-slate-800">
                        <Label htmlFor="testString" className="text-sm font-medium">Test your pattern</Label>
                        <Input
                          id="testString"
                          value={testString}
                          onChange={(e) => setTestString(e.target.value)}
                          placeholder="Enter a version like 'v1.2.3'"
                          className="mt-2"
                        />
                        {testString && (
                          <div className="mt-3 text-sm">
                            {(() => {
                              const result = testRegex()
                              if (!result) return null
                              
                              if (result.error) {
                                return (
                                  <div className="text-red-600 dark:text-red-400">
                                    <strong>Error:</strong> {result.error}
                                  </div>
                                )
                              }
                              
                              if (result.matches) {
                                return (
                                  <div className="text-green-600 dark:text-green-400">
                                    <div><strong>✓ Match:</strong> "{result.fullMatch}"</div>
                                    <div className="mt-1">
                                      <strong>Capture groups:</strong> 
                                      {result.groups.length > 0 ? (
                                        <span className="ml-2">
                                          Major: <code>{result.groups[0]}</code>, 
                                          Minor: <code>{result.groups[1] || 'missing'}</code>, 
                                          Patch: <code>{result.groups[2] || 'missing'}</code>
                                        </span>
                                      ) : (
                                        <span className="ml-2 text-orange-600 dark:text-orange-400">No capture groups found!</span>
                                      )}
                                    </div>
                                  </div>
                                )
                              } else {
                                return (
                                  <div className="text-red-600 dark:text-red-400">
                                    <strong>✗ No match</strong> - The pattern doesn't match this version
                                  </div>
                                )
                              }
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                    
                    <div className="text-xs text-slate-500 dark:text-slate-500 bg-slate-50 dark:bg-slate-800 p-2 rounded">
                      <p><strong>Examples:</strong></p>
                      <p>• <code>^v(\d+)\.(\d+)\.(\d+)$</code> matches v1.2.3</p>
                      <p>• <code>^(\d+)\.(\d+)\.(\d+)$</code> matches 1.2.3</p>
                      <p>• <code>^release-(\d+)\.(\d+)\.(\d+)$</code> matches release-1.2.3</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Automation Settings</CardTitle>
                  <CardDescription>
                    Configure how the package family monitors and creates new package versions
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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
                      <Select value={checkFrequencyMinutes.toString()} onValueChange={(value) => setCheckFrequencyMinutes(parseInt(value))}>
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

                </CardContent>
              </Card>
            </div>
          </div>

          <div className="flex justify-end space-x-4 pt-6">
            <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving || selectedPackages.length === 0}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Package Family
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="link-repository" className="space-y-6">
          {linkedError && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-red-600 dark:text-red-400">{linkedError}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Link a Repository</CardTitle>
                <CardDescription>
                  Create a package family linked to an external git repository containing melange YAML files.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="linked-name">Name</Label>
                  <Input
                    id="linked-name"
                    placeholder="e.g., replicated"
                    value={linkedName}
                    onChange={(e) => setLinkedName(e.target.value)}
                  />
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    A unique identifier for this package family.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="git-remote">Git Remote</Label>
                  <Input
                    id="git-remote"
                    placeholder="https://github.com/owner/repo.git"
                    value={gitRemote}
                    onChange={(e) => setGitRemote(e.target.value)}
                  />
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    The git remote URL to clone.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="melange-file-path">Path to Melange File</Label>
                  <Input
                    id="melange-file-path"
                    placeholder="e.g., melange.yaml"
                    value={melangeFilePath}
                    onChange={(e) => setMelangeFilePath(e.target.value)}
                  />
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Path to the melange YAML file relative to the repository root, including filename.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="initial-tag">Initial Tag</Label>
                  <Input
                    id="initial-tag"
                    placeholder="e.g., v1.0.0"
                    value={initialTag}
                    onChange={(e) => setInitialTag(e.target.value)}
                  />
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    The git tag to clone initially. Only tags are supported.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end space-x-4 pt-6">
            <Button variant="outline" onClick={handleCancel} disabled={isSavingLinked}>
              Cancel
            </Button>
            <Button onClick={handleLinkedSave} disabled={isSavingLinked}>
              {isSavingLinked && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Linked Package Family
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}