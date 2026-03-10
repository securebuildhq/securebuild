"use client";

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { exchangeGithubCodeForSession } from '@/lib/auth/actions/exchange-github-code';

function AuthCompleteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const exchangeComplete = useRef(false);

  useEffect(() => {
    const code = searchParams.get("code");

    if (!code) {
      router.push("/auth/error");
      return;
    }

    if (!exchangeComplete.current) {
      exchangeComplete.current = true;

      exchangeGithubCodeForSession(code)
        .then(async (jwt: string) => {
          const expires = new Date();
          expires.setDate(expires.getDate() + 7);
          document.cookie = `buildadmin_session=${jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

          // Check for stored redirect URL
          const storedRedirect = localStorage.getItem('postLoginRedirect');
          if (storedRedirect) {
            localStorage.removeItem('postLoginRedirect');
            try {
              router.push(storedRedirect);
            } catch (error) {
              console.error(error);
              window.location.href = storedRedirect;
            }
          } else {
              window.location.href = "/dashboard";
          }
        })
        .catch((error: unknown) => {
          console.error("Auth Error:", error);
          router.push("/auth/error");
        });
    }
  }, [searchParams, router]);

  return (
    <div className="bg-card rounded-xl shadow p-8 w-full max-w-md flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-4">Completing Login</h1>
      <p className="text-sm text-muted-foreground text-center mt-2">
        Please wait while we complete your authentication...
      </p>
    </div>
  );
}

export default function AuthCompletePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Suspense fallback={
        <div className="bg-card rounded-xl shadow p-8 w-full max-w-md flex flex-col items-center">
          <h1 className="text-3xl font-bold mb-4">Loading...</h1>
        </div>
      }>
        <AuthCompleteContent />
      </Suspense>
    </div>
  );
}