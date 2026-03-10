"use client"

import React, { Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import { Shield } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { testModeLogin, isTestModeEnabled } from "@/lib/auth/actions/test-login"

function GithubButtonWithParams() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next');
  const [isLoading, setIsLoading] = useState(false);
  const [testMode, setTestMode] = useState<boolean | null>(null);

  React.useEffect(() => {
    if (nextUrl) {
      localStorage.setItem('postLoginRedirect', nextUrl);
    } else {
      localStorage.removeItem('postLoginRedirect');
    }
  }, [nextUrl]);

  React.useEffect(() => {
    // Check if test mode is enabled
    isTestModeEnabled().then(enabled => {
      setTestMode(enabled);
    }).catch(() => {
      setTestMode(false);
    });
  }, []);

  const handleTestModeSignIn = async () => {
    setIsLoading(true);
    try {
      const jwt = await testModeLogin();

      // Set session cookie
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);
      document.cookie = `buildadmin_session=${jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

      // Redirect to stored URL or dashboard
      const storedRedirect = localStorage.getItem('postLoginRedirect');
      if (storedRedirect) {
        localStorage.removeItem('postLoginRedirect');
        router.push(storedRedirect);
      } else {
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Test login failed:', error);
      setIsLoading(false);
    }
  };

  const handleGithubSignIn = () => {
    const state = process.env.NEXT_PUBLIC_GITHUB_OAUTH_STATE;

    let githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.NEXT_PUBLIC_GITHUB_REDIRECT_URI!)}&scope=repo,user`;

    if (state) {
      githubAuthUrl += `&state=${encodeURIComponent(state)}`;
    }

    window.location.href = githubAuthUrl;
  };

  const handleSignIn = () => {
    if (testMode) {
      handleTestModeSignIn();
    } else {
      handleGithubSignIn();
    }
  };

  return <Button
    className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
    onClick={handleSignIn}
    disabled={isLoading || testMode === null}
  >
    {isLoading ? 'Signing In...' : 'Sign In'}
  </Button>;
}

export default function LoginPage() {
  const router = useRouter()
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-500">
      <div className="bg-gray-700 rounded-xl shadow-lg p-8 w-full max-w-md flex flex-col items-center text-white">
        {/* Logo/Icon */}
        <div className="mb-6">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4">
            <Shield className="w-10 h-10 text-gray-700" />
          </div>
        </div>

        {/* Title and Subtitle */}
        <h1 className="text-3xl font-bold mb-2 text-white">SecureBuild</h1>
        <p className="text-gray-300 mb-8 text-center">Secure Build Management</p>

        {/* Sign In Button */}
        <div className="w-full mb-6">
          <Suspense fallback={
            <Button className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium">
              Sign In
            </Button>
          }>
            <GithubButtonWithParams />
          </Suspense>
        </div>

        {/* Warning Text */}
        <div className="text-center space-y-2">
          <p className="text-sm text-gray-300">
            Authorized personnel only. This is a restricted area.
          </p>
          <div className="text-xs text-gray-400 border-t border-gray-600 pt-4 mt-4">
            <p className="mb-1">
              <strong>WARNING:</strong> This system is for the use of authorized users only.
            </p>
            <p className="mb-1">
              Individuals using this computer system without authority, or in excess of their authority, are subject to having all of their activities on this system monitored and recorded.
            </p>
            <p>
              Anyone using this system expressly consents to such monitoring and is advised that if such monitoring reveals possible evidence of criminal activity, it may be provided to law enforcement officials.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}