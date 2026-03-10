"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Package, Clock, AlertCircle, Settings, History, Eye, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CustomPackage, CustomPackageVersion, CustomPackageVersionAdditionalFile } from '@/lib/types/custom-package';
import { getCustomPackageAction, getCustomPackageVersionsAction, getCustomPackageAdditionalFilesAction, getCustomPackageExecutionsAction } from '@/lib/custom-packages/server-actions';
import { CustomPackageExecution } from '@/lib/custom-packages/custom-package';
import { checkCustomPackagesEnabled } from '@/lib/common/feature-flag-actions';
import { FeatureDisabled } from '@/components/feature-disabled';

export default function CustomPackageDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const packageId = params.id as string;
  
  // Extract tab from URL path
  const pathSegments = pathname.split('/');
  const currentTab = pathSegments[4] || 'configuration'; // /dashboard/custom-packages/[id]/[tab]

  const [packageData, setPackageData] = useState<CustomPackage | null>(null);
  const [versions, setVersions] = useState<CustomPackageVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<CustomPackageVersion | null>(null);
  const [additionalFiles, setAdditionalFiles] = useState<CustomPackageVersionAdditionalFile[]>([]);
  const [executions, setExecutions] = useState<CustomPackageExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const activeTab = currentTab === 'build-history' ? 'build-history' : 'configuration';

  const handleTabChange = (tab: string) => {
    if (tab === 'configuration') {
      router.push(`/dashboard/custom-packages/${packageId}`);
    } else if (tab === 'build-history') {
      router.push(`/dashboard/custom-packages/${packageId}/build-history`);
    }
  };

  const checkFeatureAndLoadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if feature is enabled
      const enabled = await checkCustomPackagesEnabled();
      setFeatureEnabled(enabled);

      if (enabled) {
        await loadPackageData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load package data');
      console.error('Error loading package data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (packageId) {
      checkFeatureAndLoadData();
    }
  }, [packageId, checkFeatureAndLoadData]);

  useEffect(() => {
    if (selectedVersion) {
      loadAdditionalFiles();
    }
  }, [selectedVersion]);

  const loadPackageData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load package info
      const pkg = await getCustomPackageAction(packageId);
      if (!pkg) {
        throw new Error('Package not found');
      }
      setPackageData(pkg);

      // Load versions
      const versionsData = await getCustomPackageVersionsAction(packageId);
      setVersions(versionsData);
      
      // Select latest version by default
      if (versionsData.length > 0) {
        setSelectedVersion(versionsData[0]);
      }

      // Load build executions
      const executionsData = await getCustomPackageExecutionsAction(packageId);
      setExecutions(executionsData);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load package data');
      console.error('Error loading package data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadAdditionalFiles = async () => {
    if (!selectedVersion) return;
    
    try {
      const files = await getCustomPackageAdditionalFilesAction(selectedVersion.id);
      setAdditionalFiles(files);
    } catch (err) {
      console.error('Error loading additional files:', err);
      setAdditionalFiles([]);
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date));
  };

  const getBuildStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'success':
        return (
          <Badge variant="default" className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Success
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'building':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Building
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            {status}
          </Badge>
        );
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/custom-packages')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Loading...</h1>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-center space-x-2">
              <Clock className="h-4 w-4 animate-spin" />
              <span>Loading package details...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if feature is disabled
  if (featureEnabled === false) {
    return (
      <FeatureDisabled 
        featureName="Custom Packages"
        description="Build and manage your custom packages"
      />
    );
  }

  if (error || !packageData) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/custom-packages')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Error</h1>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error || 'Package not found'}</AlertDescription>
        </Alert>
        <Button onClick={loadPackageData}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/custom-packages')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Package className="h-8 w-8" />
              {packageData.name}
            </h1>
            <p className="text-muted-foreground">
              Custom package • Created {formatDate(packageData.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList>
          <TabsTrigger value="configuration" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="build-history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Build History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="configuration" className="space-y-6">
          {/* Package Information */}
          <Card>
            <CardHeader>
              <CardTitle>Package Information</CardTitle>
              <CardDescription>Basic package details and metadata</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Package ID</label>
                  <p className="font-mono text-sm">{packageData.id}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Delete Protection</label>
                  <Badge variant={packageData.is_delete_protection_enabled ? "default" : "secondary"}>
                    {packageData.is_delete_protection_enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Version Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Version Configuration</CardTitle>
              <CardDescription>
                {selectedVersion ? `Version ${selectedVersion.version} - Created ${formatDate(selectedVersion.created_at)}` : 'No version selected'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Version Selector */}
              {versions.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground block mb-2">Version</label>
                  <Select 
                    value={selectedVersion?.id || ""} 
                    onValueChange={(value) => {
                      const version = versions.find(v => v.id === value);
                      setSelectedVersion(version || null);
                    }}
                  >
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Select version" />
                    </SelectTrigger>
                    <SelectContent>
                      {versions.map((version) => (
                        <SelectItem key={version.id} value={version.id}>
                          {version.version} (r{version.apk_release})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              
              {selectedVersion && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">License</label>
                      <p className="text-sm">{selectedVersion.license || "Not specified"}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">APK Release</label>
                      <p className="font-mono text-sm">{selectedVersion.apk_release}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Use Root</label>
                      <Badge variant={selectedVersion.use_root ? "destructive" : "secondary"}>
                        {selectedVersion.use_root ? "Yes" : "No"}
                      </Badge>
                    </div>
                  </div>

                  {/* Melange YAML */}
                  {selectedVersion.melange_yaml && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-muted-foreground">Melange YAML</label>
                      <div className="bg-muted p-4 rounded-md">
                        <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                          {selectedVersion.melange_yaml}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Additional Files */}
                  {additionalFiles.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-muted-foreground">Additional Files</label>
                      <div className="border rounded-md">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>File Path</TableHead>
                              <TableHead>Created</TableHead>
                              <TableHead>Size</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {additionalFiles.map((file) => (
                              <TableRow key={file.id}>
                                <TableCell className="font-mono text-sm">{file.path}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {formatDate(file.created_at)}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {file.content.length} bytes
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="build-history" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Build History</CardTitle>
              <CardDescription>View build executions for this custom package</CardDescription>
            </CardHeader>
            <CardContent>
              {executions.length === 0 ? (
                <div className="text-center py-12">
                  <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground mb-2">No build executions found</p>
                  <p className="text-xs text-muted-foreground">
                    Build executions will appear here once the package has been built
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Package</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executions.map((execution) => (
                      <TableRow key={execution.id}>
                        <TableCell className="font-medium">{execution.packageName}</TableCell>
                        <TableCell>{execution.versionLabel}</TableCell>
                        <TableCell>{getBuildStatusBadge(execution.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(new Date(execution.createdAt))}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" title="View Build Details" asChild>
                            <Link href={`/dashboard/custom-packages/${packageId}/builds/${execution.id}`}>
                              <Eye className="h-4 w-4" />
                              View Details
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}