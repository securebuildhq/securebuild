'use client'

import React, { createContext, useContext, useState, useEffect } from 'react';

interface PackageCountData {
  total: number;
  x86_64: number;
  aarch64: number;
  formatted: string;
}

interface PackageCountContextType {
  packageCount: PackageCountData | null;
}

const PackageCountContext = createContext<PackageCountContextType>({
  packageCount: null
});

interface PackageCountProviderProps {
  children: React.ReactNode;
  packageCount: PackageCountData | null;
}

export function PackageCountProvider({ children, packageCount: initialPackageCount }: PackageCountProviderProps) {
  const [packageCount, setPackageCount] = useState<PackageCountData | null>(initialPackageCount);
  const [hasFetched, setHasFetched] = useState(false);

  // Fetch package count on mount if not provided server-side
  useEffect(() => {
    if (!initialPackageCount && !hasFetched) {
      setHasFetched(true);

      fetch('/api/package-count')
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setPackageCount({
              total: data.total,
              x86_64: data.x86_64,
              aarch64: data.aarch64,
              formatted: data.formatted
            });
          }
        })
        .catch(err => {
          console.warn('Failed to fetch package count:', err);
        });
    }
  }, [initialPackageCount, hasFetched]);

  return (
    <PackageCountContext.Provider value={{ packageCount }}>
      {children}
    </PackageCountContext.Provider>
  );
}

export function usePackageCount(): PackageCountContextType {
  return useContext(PackageCountContext);
}
