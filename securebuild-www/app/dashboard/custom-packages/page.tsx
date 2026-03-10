"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle, Package, Clock, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CustomPackage } from '@/lib/types/custom-package';
import { getCustomPackagesAction } from '@/lib/custom-packages/server-actions';
import { checkCustomPackagesEnabled } from '@/lib/common/feature-flag-actions';
import { FeatureDisabled } from '@/components/feature-disabled';

export default function CustomPackagesPage() {
  const [packages, setPackages] = useState<CustomPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);

  const checkFeatureAndLoadPackages = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Check if feature is enabled
      const enabled = await checkCustomPackagesEnabled();
      setFeatureEnabled(enabled);

      if (enabled) {
        // Only load packages if feature is enabled
        const packagesData = await getCustomPackagesAction();
        setPackages(packagesData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load custom packages');
      console.error('Error loading custom packages:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkFeatureAndLoadPackages();
  }, [checkFeatureAndLoadPackages]);



  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date));
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Custom Packages</h1>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-center space-x-2">
              <Clock className="h-4 w-4 animate-spin" />
              <span>Loading custom packages...</span>
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

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Custom Packages</h1>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={checkFeatureAndLoadPackages}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Custom Packages</h1>
        <p className="text-muted-foreground">
          Manage vendor-submitted melange package configurations
        </p>
      </div>

      {packages.length === 0 ? (
        <Card>
          <CardContent className="p-12">
            <div className="text-center space-y-4">
              <Package className="h-12 w-12 mx-auto text-muted-foreground" />
              <div>
                <h3 className="text-lg font-semibold">No Custom Packages</h3>
                <p className="text-muted-foreground">
                  Your team hasn&apos;t submitted any custom melange packages yet.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Custom Packages ({packages.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package Name</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.map((pkg) => (
                  <TableRow key={pkg.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center space-x-2">
                        <Package className="h-4 w-4" />
                        <Link 
                          href={`/dashboard/custom-packages/${pkg.id}`}
                          className="hover:text-blue-600 hover:underline"
                        >
                          {pkg.name}
                        </Link>
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(pkg.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}