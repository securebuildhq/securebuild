"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { Suspense } from "react";

function AuthErrorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const message = searchParams.get("message");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="bg-card rounded-xl shadow p-8 w-full max-w-md flex flex-col items-center">
        <AlertTriangle className="w-10 h-10 text-destructive mb-4" />
        <h1 className="text-3xl font-bold mb-2">Login Error</h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          There was an error logging you in with Google.<br />
          {message && <p className="text-sm text-muted-foreground text-center mb-6">{message}</p>}
          Please try again or contact support if the problem persists.
        </p>
        <Button className="w-full" size="lg" onClick={() => router.push('/login')}>
          Return to Login
        </Button>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="bg-card rounded-xl shadow p-8 w-full max-w-md flex flex-col items-center">
        <AlertTriangle className="w-10 h-10 text-destructive mb-4" />
        <h1 className="text-3xl font-bold mb-2">Login Error</h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          Loading error details...
        </p>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <AuthErrorContent />
    </Suspense>
  );
}
