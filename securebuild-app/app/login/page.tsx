"use client"

import React, { Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Shield } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { testModeLogin, isTestModeEnabled } from "@/lib/auth/actions/test-login"
import { getAuthMethod, countUsers } from "@/lib/auth/actions/auth-config"
import { passwordLogin } from "@/lib/auth/actions/password-login"

function LoginFormWithParams() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next');
  const [isLoading, setIsLoading] = useState(false);
  const [testMode, setTestMode] = useState<boolean | null>(null);
  const [authMethod, setAuthMethod] = useState<string | null>(null);

  // Password form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

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

    // Determine the auth method and handle empty-DB cases
    getAuthMethod().then(async method => {
      if (method === "not-configured") {
        router.push('/auth/not-configured');
        return;
      }
      if (method === "password") {
        // When password auth is configured and no users exist, go to initial setup
        const userCount = await countUsers();
        if (userCount === 0) {
          router.push('/auth/setup');
          return;
        }
      }
      setAuthMethod(method);
    }).catch(() => {
      setAuthMethod(null);
    });
  }, [router]);

  const redirectAfterLogin = () => {
    const storedRedirect = localStorage.getItem('postLoginRedirect');
    if (storedRedirect) {
      localStorage.removeItem('postLoginRedirect');
      router.push(storedRedirect);
    } else {
      router.push('/dashboard');
    }
  };

  const handleTestModeSignIn = async () => {
    setIsLoading(true);
    try {
      const jwt = await testModeLogin();

      // Set session cookie
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);
      document.cookie = `buildadmin_session=${jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

      redirectAfterLogin();
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

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoading(true);
    try {
      const jwt = await passwordLogin(email, password);

      // Set session cookie (same pattern as github login)
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);
      document.cookie = `buildadmin_session=${jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

      redirectAfterLogin();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed. Please try again.";
      setLoginError(message);
      setIsLoading(false);
    }
  };

  const handleSignIn = () => {
    if (testMode) {
      handleTestModeSignIn();
    } else {
      handleGithubSignIn();
    }
  };

  // Password auth form
  if (!testMode && authMethod === "password") {
    return (
      <form onSubmit={handlePasswordSubmit} className="w-full flex flex-col gap-4">
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="bg-gray-600 border-gray-500 text-white placeholder-gray-400"
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="bg-gray-600 border-gray-500 text-white placeholder-gray-400"
        />
        {loginError && (
          <p className="text-sm text-red-400 text-center">{loginError}</p>
        )}
        <Button
          type="submit"
          className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
          disabled={isLoading}
        >
          {isLoading ? 'Signing In...' : 'Sign In'}
        </Button>
        <div className="text-center">
          <a href="/auth/reset-password" className="text-sm text-gray-400 hover:text-gray-300 underline">
            Forgot password?
          </a>
        </div>
      </form>
    );
  }

  // GitHub / test mode button (default)
  return (
    <Button
      className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
      onClick={handleSignIn}
      disabled={isLoading || testMode === null || authMethod === null}
    >
      {isLoading ? 'Signing In...' : 'Sign In'}
    </Button>
  );
}

export default function LoginPage() {
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

        {/* Sign In Form */}
        <div className="w-full mb-6">
          <Suspense fallback={
            <Button className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium">
              Sign In
            </Button>
          }>
            <LoginFormWithParams />
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
