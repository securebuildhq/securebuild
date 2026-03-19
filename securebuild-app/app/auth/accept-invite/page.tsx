"use client";

import React, { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { validateInviteToken, acceptInvite } from "@/lib/auth/actions/invite";

function AcceptInviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  // Validation state
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);

  // Form state
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Validate the token on mount
  React.useEffect(() => {
    if (!token) {
      setTokenValid(false);
      return;
    }

    validateInviteToken(token)
      .then((email) => {
        if (email) {
          setInviteEmail(email);
          setTokenValid(true);
        } else {
          setTokenValid(false);
        }
      })
      .catch(() => {
        setTokenValid(false);
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    try {
      const jwt = await acceptInvite(token!, password);

      const expires = new Date();
      expires.setDate(expires.getDate() + 7);
      document.cookie = `buildadmin_session=${jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

      router.push("/dashboard");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to accept invite. Please try again.";
      setFormError(message);
      setIsLoading(false);
    }
  };

  // Still validating
  if (tokenValid === null) {
    return (
      <p className="text-gray-300 text-center">Validating invite link...</p>
    );
  }

  // Invalid token
  if (!tokenValid) {
    return (
      <>
        <p className="text-gray-300 text-center mb-6">
          This invite link is invalid or has expired.
        </p>
        <div className="text-center">
          <a
            href="/login"
            className="text-sm text-gray-400 hover:text-gray-300 underline"
          >
            Back to login
          </a>
        </div>
      </>
    );
  }

  // Valid token - show accept form
  return (
    <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
      <p className="text-gray-300 text-center text-sm">
        You have been invited to SecureBuild.
      </p>
      <p className="text-white text-center font-medium">{inviteEmail}</p>
      <p className="text-gray-400 text-center text-sm mb-2">
        Create a password to complete your account setup.
      </p>
      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="new-password"
        className="bg-gray-600 border-gray-500 text-white placeholder-gray-400"
      />
      <Input
        type="password"
        placeholder="Confirm Password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
        autoComplete="new-password"
        className="bg-gray-600 border-gray-500 text-white placeholder-gray-400"
      />
      {formError && (
        <p className="text-sm text-red-400 text-center">{formError}</p>
      )}
      <Button
        type="submit"
        className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
        disabled={isLoading}
      >
        {isLoading ? "Creating Account..." : "Create Account"}
      </Button>
      <div className="text-center">
        <a
          href="/login"
          className="text-sm text-gray-400 hover:text-gray-300 underline"
        >
          Back to login
        </a>
      </div>
    </form>
  );
}

function AcceptInviteFallback() {
  return (
    <Button
      className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
      disabled
    >
      Loading...
    </Button>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-500">
      <div className="bg-gray-700 rounded-xl shadow-lg p-8 w-full max-w-md flex flex-col items-center text-white">
        <div className="mb-6">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4">
            <Shield className="w-10 h-10 text-gray-700" />
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-2 text-white">SecureBuild</h1>
        <p className="text-gray-300 mb-8 text-center">Accept Invitation</p>

        <div className="w-full mb-6">
          <Suspense fallback={<AcceptInviteFallback />}>
            <AcceptInviteContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
