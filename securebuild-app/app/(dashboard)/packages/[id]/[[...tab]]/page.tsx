"use client"

import { useState, useEffect, useMemo } from "react"
import { usePackageContext } from "../package-context"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CodeEditor } from "@/components/code-editor"
import { ExecutionsTable } from "@/components/executions-table"
import { AdditionalFilesEditor } from "@/components/additional-files-editor"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { AlertCircle, AlertTriangle, Triangle, GitBranch } from "lucide-react"
import { PackageStatusIndicator } from "@/components/package-status-indicator"
import * as yaml from "js-yaml"

export default function PackageDetailPage() {
  const {
    pkg, executions, executionsLoading, melangeYaml, setMelangeYaml,
    selectedVersionData, isSavingConfig,
    useRoot, setUseRoot, bootstrapEnabled, setBootstrapEnabled,
    bootstrapApkRepository, setBootstrapApkRepository, bootstrapKeyringAppend, setBootstrapKeyringAppend,
    customDiskSize, setCustomDiskSize, dependencies,
    dependenciesLoading, handleSaveConfiguration, handleSaveAndBuild, isSavingAndBuilding, renderVersionSelector,
    parseVersionKey, selectedVersion, session, activeTab, handleSetDeleteProtection, getLastSuccessfulBuildDuration,
    isLastBuildTimedOut, getLastSuccessfulBuildSettings, isSelectedRevisionImmutable
  } = usePackageContext()

  const isLinkedRevision = !!selectedVersionData?.gitRemote
  const isEditorReadOnly = isLinkedRevision || isSelectedRevisionImmutable()
  const areSaveButtonsDisabled = isLinkedRevision || isSelectedRevisionImmutable()

  // Helper function to check if a setting differed from defaults in last successful build
  const getDeltaIcon = (currentValue: any, defaultValue: any, successfulValue: any) => {
    const lastSuccessfulSettings = getLastSuccessfulBuildSettings();
    if (!lastSuccessfulSettings) return null;
    
    // Normalize values to handle null/empty string as equivalent to defaults
    const normalizeValue = (value: any, defaultVal: any) => {
      // For boolean toggles, treat null/undefined as false (default)
      if (typeof defaultVal === 'boolean') {
        return value === null || value === undefined ? false : Boolean(value);
      }
      // For string values (like build timeout), treat null/undefined/empty as null (default)
      if (defaultVal === null) {
        return value === null || value === undefined || value === '' ? null : value;
      }
      // For other types, use direct comparison
      return value;
    };
    
    const normalizedSuccessful = normalizeValue(successfulValue, defaultValue);
    const normalizedDefault = normalizeValue(defaultValue, defaultValue);
    
    // Check if the successful build used a non-default value
    const wasNonDefault = normalizedSuccessful !== normalizedDefault;
    if (!wasNonDefault) return null;
    
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Triangle 
            className="h-3 w-3 text-blue-500 ml-1 inline cursor-help" 
            fill="currentColor"
          />
        </TooltipTrigger>
        <TooltipContent>
          <p>Last build used a custom setting</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  // Helper function to extract repositories and keyrings from melange YAML
  const extractReposAndKeyrings = () => {
    // Use selectedVersionData.melangeYaml if available, otherwise fall back to melangeYaml
    const yamlContent = selectedVersionData ? selectedVersionData.melangeYaml : melangeYaml;
    if (!yamlContent) return { repositories: [], keyrings: [] };
    
    try {
      // Simple regex parsing for repositories and keyrings from melange YAML
      const repoMatches = yamlContent.match(/repositories:\s*\n((?:\s*-\s*[^\n]+\n?)*)/);
      const keyringMatches = yamlContent.match(/keyring:\s*\n((?:\s*-\s*[^\n]+\n?)*)/);
      
      const repositories = [];
      const keyrings = [];
      
      if (repoMatches) {
        // Updated regex to handle variable whitespace after the dash (including no space)
        const repoLines = repoMatches[1].match(/^\s*-\s*([^\n#]+)/gm);
        if (repoLines) {
          repositories.push(...repoLines.map((line: string) => line.replace(/^\s*-\s*/, '').trim()));
        }
      }
      
      if (keyringMatches) {
        // Updated regex to handle variable whitespace after the dash (including no space)
        const keyringLines = keyringMatches[1].match(/^\s*-\s*([^\n#]+)/gm);
        if (keyringLines) {
          keyrings.push(...keyringLines.map((line: string) => line.replace(/^\s*-\s*/, '').trim()));
        }
      }
      
      return { repositories, keyrings };
    } catch (error) {
      return { repositories: [], keyrings: [] };
    }
  };

  const { repositories: melangeRepos, keyrings: melangeKeyrings } = extractReposAndKeyrings();
  
  // Get bootstrap repositories and keyrings (if enabled)
  const bootstrapRepos = bootstrapEnabled && bootstrapApkRepository 
    ? bootstrapApkRepository.split(' ').filter((repo: string) => repo.trim()) 
    : [];
  const bootstrapKeys = bootstrapEnabled && bootstrapKeyringAppend 
    ? bootstrapKeyringAppend.split(' ').filter((key: string) => key.trim()) 
    : [];

  // Combine all unique repositories and keyrings
  const allRepositories = [...new Set([...melangeRepos, ...bootstrapRepos])];
  const allKeyrings = [...new Set([...melangeKeyrings, ...bootstrapKeys])];
  
  const apkRepoHostname = (() => {
    try { return new URL(process.env.NEXT_PUBLIC_APK_REPOSITORY!).hostname; } catch { return 'NEXT_PUBLIC_APK_REPOSITORY is not configured'; }
  })();

  const apkRepoUrl = process.env.NEXT_PUBLIC_APK_REPOSITORY || 'NEXT_PUBLIC_APK_REPOSITORY is not configured';

  // Helper function to determine if a repository is external (not managed by SecureBuild)
  const isExternalRepository = (repo: string): boolean => {
    // Internal repositories typically include SecureBuild managed domains
    const internalPatterns = [
      apkRepoHostname,
      'securebuild',
      'localhost'
    ];
    return !internalPatterns.some(pattern => repo.includes(pattern));
  };

  // Helper function to determine if a keyring is external (not managed by SecureBuild)
  const isExternalKeyring = (keyring: string): boolean => {
    // Internal keyrings typically include SecureBuild managed domains
    const internalPatterns = [
      apkRepoHostname,
      'securebuild',
      'localhost'
    ];
    return !internalPatterns.some(pattern => keyring.includes(pattern));
  };

  // Form validation state
  const [bootstrapRepoError, setBootstrapRepoError] = useState<string>("")
  const [bootstrapKeyringError, setBootstrapKeyringError] = useState<string>("")
  const [customDiskSizeError, setCustomDiskSizeError] = useState<string>("")

  // Check for epoch mismatch - using useMemo to make it reactive
  const epochMismatch = useMemo(() => {
    try {
      // Always use the current melangeYaml state to reflect live edits
      const yamlContent = melangeYaml;
      if (!yamlContent) return null;
      
      const parsed = yaml.load(yamlContent) as any;
      if (!parsed?.package) return null;
      
      // Check if epoch exists in YAML (could be 0, which is valid)
      if (!('epoch' in parsed.package)) return null;
      
      const epochInYaml = parsed.package.epoch;
      
      // Get the current release from selectedVersionData or parse from version key
      let currentRelease: number | undefined;
      if (selectedVersionData?.apkRelease !== undefined) {
        currentRelease = selectedVersionData.apkRelease;
      } else if (selectedVersion) {
        const versionInfo = parseVersionKey(selectedVersion);
        currentRelease = versionInfo?.apkRelease;
      }
      
      // Both epoch and release must be defined and different to show warning
      if (epochInYaml !== undefined && currentRelease !== undefined && epochInYaml !== currentRelease) {
        return {
          epochInYaml,
          actualRelease: currentRelease
        };
      }
    } catch (error) {
      // Silently ignore parse errors while user is typing
    }
    return null;
  }, [melangeYaml, selectedVersionData, selectedVersion, parseVersionKey]);

  // Validation function for bootstrap repository
  const validateBootstrapRepo = (value: string): string => {
    if (!value.trim()) return "" // Empty is allowed
    
    if (value.includes('--apk-repository')) {
      return "Do not include '--apk-repository' flag. Enter only repository URLs."
    }
    
    // Split by spaces and validate each URL
    const urls = value.trim().split(/\s+/).filter(url => url.length > 0)
    
    for (const url of urls) {
      try {
        new URL(url)
      } catch {
        return `Invalid URL: ${url}. Each URL must be valid (e.g., https://dl-cdn.alpinelinux.org/alpine/v3.19/main)`
      }
    }
    
    return "" // All URLs are valid
  }

  // Validation function for bootstrap keyring
  const validateBootstrapKeyring = (value: string): string => {
    if (!value.trim()) return "" // Empty is allowed

    if (value.includes('--keyring-append')) {
      return "Do not include '--keyring-append' flag. Enter only keyring URLs."
    }

    // Split by spaces and validate each URL
    const urls = value.trim().split(/\s+/).filter(url => url.length > 0)

    for (const url of urls) {
      try {
        new URL(url)
      } catch {
        return `Invalid URL: ${url}. Each URL must be valid (e.g., https://packages.example.dev/x86_64/signing.rsa.pub)`
      }
    }

    return "" // All URLs are valid
  }

  // Validation function for custom disk size
  const validateCustomDiskSize = (value: string): string => {
    if (!value.trim()) return "" // Empty is allowed (uses default)

    const numValue = parseInt(value.trim())

    if (isNaN(numValue)) {
      return "Must be a valid number"
    }

    return "" // Valid
  }

  // Handle bootstrap repository input change
  const handleBootstrapRepoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setBootstrapApkRepository(value)
    
    // Validate input and set error
    const error = validateBootstrapRepo(value)
    setBootstrapRepoError(error)
  }

  // Handle bootstrap keyring input change
  const handleBootstrapKeyringChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setBootstrapKeyringAppend(value)

    // Validate input and set error
    const error = validateBootstrapKeyring(value)
    setBootstrapKeyringError(error)
  }

  // Handle custom disk size input change
  const handleCustomDiskSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setCustomDiskSize(value)

    // Validate input and set error
    const error = validateCustomDiskSize(value)
    setCustomDiskSizeError(error)
  }

  // Validate when bootstrap values change (e.g., from package data load)
  useEffect(() => {
    if (bootstrapApkRepository !== undefined) {
      const error = validateBootstrapRepo(bootstrapApkRepository)
      setBootstrapRepoError(error)
    }
  }, [bootstrapApkRepository])

  useEffect(() => {
    if (bootstrapKeyringAppend !== undefined) {
      const error = validateBootstrapKeyring(bootstrapKeyringAppend)
      setBootstrapKeyringError(error)
    }
  }, [bootstrapKeyringAppend])

  useEffect(() => {
    if (customDiskSize !== undefined) {
      const error = validateCustomDiskSize(customDiskSize)
      setCustomDiskSizeError(error)
    }
  }, [customDiskSize])

  if (!pkg) {
    return null; // Or a loading indicator, though layout should handle the main loading state
  }

  const handleDeleteProtectionChange = async () => {
    await handleSetDeleteProtection(!pkg.isDeleteProtectionEnabled)
  }

  return (
    <>
      {activeTab === 'executions' && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Executions</CardTitle>
            <CardDescription>History of package builds</CardDescription>
          </CardHeader>
          <CardContent>
            {executionsLoading ? (
              <div className="flex justify-center items-center py-8">
                <div>Loading executions...</div>
              </div>
            ) : executions.length === 0 ? (
              <div className="flex justify-center items-center py-8 text-muted-foreground">
                No executions found for this package.
              </div>
            ) : (
              <ExecutionsTable executions={executions} />
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'configuration' && (
        <>
          <PackageStatusIndicator executions={executions} loading={executionsLoading} />
          <Card>
            <CardHeader>
              <CardTitle>Build Configuration</CardTitle>
            </CardHeader>
          <CardContent>
            {renderVersionSelector()}
            {selectedVersionData?.gitRemote && (
              <div className="mb-4 border rounded-lg p-4 bg-muted/30">
                <div className="flex items-center gap-2 mb-3">
                  <GitBranch className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-semibold">Git Repository</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Remote</span>
                    <p className="font-mono">{selectedVersionData.gitRemote}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">File</span>
                    <p className="font-mono">{selectedVersionData.melangeFilePath || "-"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Tag</span>
                    <p className="font-mono">{selectedVersionData.gitTag || "-"}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Commit SHA</span>
                    <p className="font-mono">{selectedVersionData.gitCommitSha || "-"}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2 mb-4">
              <div className="font-semibold mb-1">Melange YAML</div>
              {epochMismatch && (
                <Alert className="mb-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Warning: The epoch value in the melange file ({epochMismatch.epochInYaml}) does not match the release version ({epochMismatch.actualRelease}). 
                    When building, epoch {epochMismatch.actualRelease} will be used instead of {epochMismatch.epochInYaml}.
                  </AlertDescription>
                </Alert>
              )}
              <div>
                <CodeEditor
                  value={selectedVersionData ? selectedVersionData.melangeYaml : melangeYaml}
                  onChange={setMelangeYaml}
                  language="yaml"
                  height="420px"
                  readOnly={isEditorReadOnly}
                />
                {isLinkedRevision && (
                  <p className="text-xs text-muted-foreground mt-1">
                    This melange file is linked to a git repository and cannot be edited.
                  </p>
                )}
              </div>
            </div>
            
            {/* Build Settings Section */}
            <div className="border-t pt-4">
              <h3 className="text-lg font-semibold mb-3">Build Settings</h3>
              <TooltipProvider>
            {/* Custom Disk Size Field */}
            <div className="mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Label htmlFor="custom-disk-size" className="font-semibold shrink-0">
                  Custom Disk Size (GB):
                </Label>
                <Input
                  id="custom-disk-size"
                  type="number"
                  placeholder=""
                  value={customDiskSize}
                  onChange={handleCustomDiskSizeChange}
                  className={`w-32 h-8 text-sm ${customDiskSizeError ? 'border-red-500 focus:border-red-500' : ''}`}
                />
                <span className="text-sm text-muted-foreground min-w-0">
                  (optional. Leave empty or 0 for default 50GB)
                </span>
              </div>
              {customDiskSizeError && (
                <div className="flex items-center gap-2 text-sm text-red-600 mt-1">
                  <AlertCircle className="h-3 w-3" />
                  <span>{customDiskSizeError}</span>
                </div>
              )}
            </div>
            
            {/* Toggles in a more compact grid */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="delete-protection"
                    checked={pkg.isDeleteProtectionEnabled}
                    onCheckedChange={handleDeleteProtectionChange}
                  />
                  <Label htmlFor="delete-protection" className="font-semibold text-sm flex items-center">
                    Delete Protection
                    {/* Note: Delete protection is a package-level setting, not execution-level */}
                  </Label>
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="use-root"
                    checked={useRoot}
                    onCheckedChange={setUseRoot}
                  />
                  <Label htmlFor="use-root" className="font-semibold text-sm">
                    Use Root (sudo)
                  </Label>
                </div>
              </div>
            </div>
            
            
            {/* Bootstrap Toggle */}
            <div className="mb-3">
              <div className="flex items-center space-x-2 mb-1">
                <Switch
                  id="bootstrap-enabled"
                  checked={bootstrapEnabled}
                  onCheckedChange={setBootstrapEnabled}
                />
                <Label htmlFor="bootstrap-enabled" className="font-semibold text-sm">
                  Bootstrap Mode
                </Label>
              </div>
              {bootstrapEnabled && (
                <div className="mt-2 space-y-2 pl-6">
                  <div>
                    <Label htmlFor="bootstrap-apk-repository" className="text-sm font-medium">
                      Custom APK Repositories <span className="text-muted-foreground font-normal">(optional. ex: {apkRepoUrl} https://mirrors.edge.kernel.org/alpine/edge/main)</span>
                    </Label>
                    <Input
                      id="bootstrap-apk-repository"
                      placeholder={`${apkRepoUrl} https://dl-cdn.alpinelinux.org/alpine/v3.19/main`}
                      value={bootstrapApkRepository}
                      onChange={handleBootstrapRepoChange}
                      className={`mt-1 h-8 text-sm ${bootstrapRepoError ? 'border-red-500 focus:border-red-500' : ''}`}
                    />
                    {bootstrapRepoError && (
                      <div className="flex items-center gap-2 text-sm text-red-600 mt-1">
                        <AlertCircle className="h-3 w-3" />
                        <span>{bootstrapRepoError}</span>
                      </div>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="bootstrap-keyring-append" className="text-sm font-medium">
                      Custom Keyrings <span className="text-muted-foreground font-normal">(optional: {apkRepoUrl}/key/cve0-signing.rsa.pub )</span>
                    </Label>
                    <Input
                      id="bootstrap-keyring-append"
                      placeholder={`${apkRepoUrl}/key/cve0-signing.rsa.pub https://alpinelinux.org/keys/...`}
                      value={bootstrapKeyringAppend}
                      onChange={handleBootstrapKeyringChange}
                      className={`mt-1 h-8 text-sm ${bootstrapKeyringError ? 'border-red-500 focus:border-red-500' : ''}`}
                    />
                    {bootstrapKeyringError && (
                      <div className="flex items-center gap-2 text-sm text-red-600 mt-1">
                        <AlertCircle className="h-3 w-3" />
                        <span>{bootstrapKeyringError}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {/* Save Configuration Buttons */}
            <div className="mt-4 flex justify-end gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      onClick={handleSaveConfiguration}
                      disabled={
                        isSavingConfig ||
                        isSavingAndBuilding ||
                        (pkg && (!melangeYaml || melangeYaml.trim() === '')) ||
                        !!bootstrapRepoError ||
                        !!bootstrapKeyringError ||
                        !!customDiskSizeError ||
                        areSaveButtonsDisabled
                      }
                    >
                      {isSavingConfig ? "Saving..." : "Save Configuration"}
                    </Button>
                  </span>
                </TooltipTrigger>
                {isSelectedRevisionImmutable() && (
                  <TooltipContent>
                    <p>Packages are immutable. If you need to build a new package, create a new release.</p>
                  </TooltipContent>
                )}
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      onClick={handleSaveAndBuild}
                      disabled={
                        isSavingConfig ||
                        isSavingAndBuilding ||
                        (pkg && (!melangeYaml || melangeYaml.trim() === '')) ||
                        !!bootstrapRepoError ||
                        !!bootstrapKeyringError ||
                        !!customDiskSizeError ||
                        areSaveButtonsDisabled
                      }
                    >
                      {isSavingAndBuilding ? "Saving & Building..." : "Save & Build"}
                    </Button>
                  </span>
                </TooltipTrigger>
                {isSelectedRevisionImmutable() && (
                  <TooltipContent>
                    <p>Packages are immutable. If you need to build a new package, create a new release.</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
              </TooltipProvider>
            </div>
          </CardContent>
        </Card>
        </>
      )}
      
      {activeTab === 'configuration' && (() => {
        const lastSuccessfulSettings = getLastSuccessfulBuildSettings();
        return lastSuccessfulSettings ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                Last Successful Build Settings
                <span className="text-sm font-normal text-muted-foreground">
                  ({new Date(lastSuccessfulSettings.executedAt).toLocaleString()})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded border border-amber-200">
                  <strong>Note:</strong> Only showing settings that were actually recorded during execution. 
                  Other settings (disk size, bootstrap config) may have been different but aren't stored per-execution.
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-muted-foreground">Execution Duration:</span>
                      {(() => {
                        const lastSuccessfulDuration = getLastSuccessfulBuildDuration();
                        return lastSuccessfulDuration ? (
                          <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded">
                            {lastSuccessfulDuration}
                          </span>
                        ) : (
                          <span className="ml-2 text-muted-foreground">Unknown</span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null;
      })()}

      {activeTab === 'additional-files' && (
        <Card>
          <CardHeader>
            <CardTitle>Additional Files</CardTitle>
            <CardDescription>Manage additional files for this package version.  Files can be renamed or deleted by right clicking on them.</CardDescription>
          </CardHeader>
          <CardContent>
            {renderVersionSelector()}
            {selectedVersion && (() => {
              const versionInfo = parseVersionKey(selectedVersion);
              if (versionInfo) {
                return (
                  <AdditionalFilesEditor
                    session={session}
                    packageId={pkg.id}
                    version={versionInfo.version}
                    apkRelease={versionInfo.apkRelease}
                  />
                );
              }
              return null;
            })()}
          </CardContent>
        </Card>
      )}
    </>
  )
}
