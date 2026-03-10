"use client"

import { ReactNode } from 'react';
import DashboardHeader from '@/components/dashboard-header';
import DashboardSidebar from '@/components/dashboard-sidebar';
import { useSession } from '@/app/hooks/use-session';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const { session, isSessionLoading } = useSession(true);
  const user = session?.user;

  // Show loading state while session is being validated
  if (isSessionLoading) {
    return (
      <div className="flex min-h-screen flex-col">
        <DashboardHeader user={null} />
        <div className="flex flex-1">
          <DashboardSidebar />
          <main className="flex-1 p-6 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
              <div>Loading...</div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  // If no session, redirect will be handled by useSession(true)
  if (!session || !user) {
    return (
      <div className="flex min-h-screen flex-col">
        <DashboardHeader user={null} />
        <div className="flex flex-1">
          <DashboardSidebar />
          <main className="flex-1 p-6 flex items-center justify-center">
            <div className="text-center">
              <div>Redirecting to Login page...</div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  // Render the layout with session available
  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader user={user} />
      <div className="flex flex-1">
        <DashboardSidebar />
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
