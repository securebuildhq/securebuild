"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";

export default function AuthNotConfiguredPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="bg-card rounded-xl shadow p-8 w-full max-w-md flex flex-col items-center">
        <AlertTriangle className="w-10 h-10 text-destructive mb-4" />
        <h1 className="text-3xl font-bold mb-2">Authentication Not Configured</h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          No authentication method is configured. Please set AUTH_METHOD to either
          &apos;password&apos; or &apos;github&apos; in your environment configuration. For password
          authentication, also configure SMTP settings and run initial setup.
        </p>
        <Button className="w-full" size="lg" onClick={() => router.push('/login')}>
          Return to Login
        </Button>
      </div>
    </div>
  );
}
