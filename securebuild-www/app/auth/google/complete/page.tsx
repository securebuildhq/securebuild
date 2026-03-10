"use client"

import { useEffect, useRef, Suspense } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { exchangeGoogleCodeForSessionAction, LoginResult } from "@/lib/auth/actions/exchange-google-code-for-session"
import { validateSession } from "@/lib/auth/actions/validate-session"
import posthog from 'posthog-js'

function GoogleAuthHandler() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const exchangeComplete = useRef(false);

  useEffect(() => {
    const code = searchParams.get("code");

    if (!code) {
      router.push("/auth/error");
      return;
    }


    if (!exchangeComplete.current) {
      exchangeComplete.current = true;

      // look for an invite in session storage
      const invite = sessionStorage.getItem("invite");
      let inviteId: string | undefined;
      if (invite) {
        inviteId = JSON.parse(invite).id;
      }
      exchangeGoogleCodeForSessionAction(code, inviteId)
        .then(async (result: LoginResult) => {
          if (result.error) {
            console.error("Google auth error:", result.error);
            router.push("/auth/error?message=" + result.error);
            return;
          }

          const expires = new Date();
          expires.setDate(expires.getDate() + 7);
          document.cookie = `session=${result.jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

          sessionStorage.removeItem("invite");

          const session = await validateSession(result.jwt);
          if (!session) {
            router.push("/auth/error?message=Invalid session");
            return;
          }

          posthog.identify(session.user.id, {
            email: session.user.email,
            name: session.user.firstName + " " + session.user.lastName,
          });

          // const team = session.teams.find(t => t.id === session.selectedTeamId);
          // if (!team) {
          //   router.push("/auth/error?message=Invalid team");
          //   return;
          // }
          // posthog.group("team", team.id, {
          //   name: team.name,
          // });

          // Check for stored redirect URL
          const storedRedirect = localStorage.getItem('postLoginRedirect');
          if (storedRedirect) {
            localStorage.removeItem('postLoginRedirect');
            try {
              router.push(storedRedirect);
            } catch (error) {
              console.error("Error redirecting to stored URL:", error);
              window.location.href = storedRedirect;
            }
          } else {
            router.push("/dashboard");
          }
        })
        .catch((error: unknown) => {
          console.error("Google auth error:", error);
          router.push("/auth/error?message=" + error);
        });
    }
  }, [searchParams, router]); // Added searchParams and router to dependency array

  return null; // This component doesn't render anything itself
}

export default function GoogleAuthCompletePage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 flex h-16 items-center">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
            <span className="text-xl font-bold">SecureBuild</span>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
        <Suspense fallback={<LoadingSpinner />}>
          <GoogleAuthHandler />
        </Suspense>
        <div className="flex items-center space-x-2">
          <div className="h-8 w-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xl font-semibold text-gray-700 dark:text-gray-200">
            Completing Google login...
          </p>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Please wait while we securely log you in.
        </p>
      </main>

      {/* Footer */}
      <footer className="py-6 bg-gray-100 dark:bg-gray-800">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 text-center">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} SecureBuild. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}

// Simple loading spinner component
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center">
      <div className="h-8 w-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}
