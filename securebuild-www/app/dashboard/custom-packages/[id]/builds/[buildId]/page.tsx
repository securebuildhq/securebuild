"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Package, Clock, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getCustomPackageAction, getCustomPackageExecutionsAction } from '@/lib/custom-packages/server-actions';
import { CustomPackageExecution } from '@/lib/custom-packages/custom-package';
import { CustomPackage } from '@/lib/types/custom-package';
import { checkCustomPackagesEnabled } from '@/lib/common/feature-flag-actions';
import { FeatureDisabled } from '@/components/feature-disabled';

export default function CustomPackageBuildDetailPage() {
  const params = useParams();
  const router = useRouter();
  const packageId = params.id as string;
  const buildId = params.buildId as string;

  const [packageData, setPackageData] = useState<CustomPackage | null>(null);
  const [buildExecution, setBuildExecution] = useState<CustomPackageExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (packageId && buildId) {
      checkFeatureAndLoadData();
    }
  }, [packageId, buildId]);

  const checkFeatureAndLoadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if feature is enabled
      const enabled = await checkCustomPackagesEnabled();
      setFeatureEnabled(enabled);

      if (enabled) {
        await loadBuildData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load build data');
      console.error('Error loading build data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadBuildData = async () => {
    // Load package info
    const pkg = await getCustomPackageAction(packageId);
    if (!pkg) {
      throw new Error('Package not found');
    }
    setPackageData(pkg);

    // Load all executions to find the specific build
    const executions = await getCustomPackageExecutionsAction(packageId);
    const execution = executions.find(e => e.id === buildId);
    if (!execution) {
      throw new Error('Build execution not found');
    }
    setBuildExecution(execution);
  };

  const formatDate = (date: string | Date) => {
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
          <Button variant="ghost" size="sm" onClick={() => router.push(`/dashboard/custom-packages/${packageId}/build-history`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Loading...</h1>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-center space-x-2">
              <Clock className="h-4 w-4 animate-spin" />
              <span>Loading build details...</span>
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

  if (error || !packageData || !buildExecution) {
    return (
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/dashboard/custom-packages/${packageId}/build-history`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Error</h1>
        </div>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error || 'Build execution not found'}</AlertDescription>
        </Alert>
        <Button onClick={loadBuildData}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/dashboard/custom-packages/${packageId}/build-history`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Package className="h-8 w-8" />
              {packageData.name}
            </h1>
            <p className="text-muted-foreground">
              Build Details • {formatDate(buildExecution.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Build Information */}
      <Card>
        <CardHeader>
          <CardTitle>Build Information</CardTitle>
          <CardDescription>Details about this build execution</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Build ID</label>
              <p className="font-mono text-sm">{buildExecution.id}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Version</label>
              <p className="text-sm">{buildExecution.versionLabel}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <div className="mt-1">
                {getBuildStatusBadge(buildExecution.status)}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Created</label>
              <p className="text-sm">{formatDate(buildExecution.createdAt)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Build Logs */}
      {(buildExecution.aarch64_build_stderr || buildExecution.x86_64_build_stderr) ? (
        <div className="space-y-6">
          {buildExecution.x86_64_build_stderr && (
            <Card>
              <CardHeader>
                <CardTitle>x86_64 Build Output</CardTitle>
                <CardDescription>Melange build logs for x86_64 architecture</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-black text-green-400 p-4 rounded text-sm font-mono max-h-96 overflow-y-auto">
                  <pre className="whitespace-pre-wrap">{buildExecution.x86_64_build_stderr}</pre>
                </div>
              </CardContent>
            </Card>
          )}
          {buildExecution.aarch64_build_stderr && (
            <Card>
              <CardHeader>
                <CardTitle>aarch64 Build Output</CardTitle>
                <CardDescription>Melange build logs for aarch64 architecture</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-black text-green-400 p-4 rounded text-sm font-mono max-h-96 overflow-y-auto">
                  <pre className="whitespace-pre-wrap">{buildExecution.aarch64_build_stderr}</pre>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-12">
            <div className="text-center space-y-4">
              <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold">No Build Logs Available</h3>
                <p className="text-muted-foreground">
                  Build logs are not available for this execution.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}