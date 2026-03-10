'use client'

import React from 'react';
import { usePackageCount } from '../lib/context/PackageCountContext';

interface PackageCountProps {
  fallback?: string;
}

/**
 * Component that displays package count from preloaded app data
 * No loading states needed - data is preloaded at app level
 */
export function PackageCount({ fallback = "over 2,000 APK packages" }: PackageCountProps) {
  const { packageCount } = usePackageCount();

  if (packageCount?.formatted) {
    return <span>{packageCount.formatted} APK packages</span>;
  }

  return <span>{fallback}</span>;
}

/**
 * Component for use in sentences - no extra spacing
 */
export function InlinePackageCount({ fallback = "over 2,000" }: PackageCountProps) {
  const { packageCount } = usePackageCount();

  if (packageCount?.formatted) {
    return <span>{packageCount.formatted}</span>;
  }

  return <span>{fallback}</span>;
}
