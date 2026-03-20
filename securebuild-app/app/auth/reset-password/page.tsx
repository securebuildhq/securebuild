"use client";

import React, { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  requestPasswordReset,
  validateResetNonce,
  resetPassword,
} from "@/lib/auth/actions/reset-password";

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nonce = searchParams.get("nonce");

  // Request-form state
  const [requestEmail, setRequestEmail] = useState("");
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);

  // Set-password-form state
  const [nonceValid, setNonceValid] = useState<boolean | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  // Validate the nonce on mount when it is present
  React.useEffect(() => {
    if (nonce) {
      validateResetNonce(nonce)
        .then((valid) => {
          setNonceValid(valid);
        })
        .catch(() => {
          setNonceValid(false);
        });
    }
  }, [nonce]);

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestLoading(true);
    try {
      await requestPasswordReset(requestEmail);
    } catch {
      // Swallow errors - always show the same message for security
    } finally {
      setRequestSubmitted(true);
      setRequestLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);

    if (newPassword.length < 8) {
      setResetError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setResetError("Passwords do not match.");
      return;
    }

    setResetLoading(true);
    try {
      const jwt = await resetPassword(nonce!, newPassword);

      const expires = new Date();
      expires.setDate(expires.getDate() + 7);
      document.cookie = `buildadmin_session=${jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

      router.push("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reset password. Please try again.";
      setResetError(message);
      setResetLoading(false);
    }
  };

  // --- Render: set-password form (nonce present) ---
  if (nonce) {
    // Still validating
    if (nonceValid === null) {
      return (
        <p className="text-gray-300 text-center">Validating reset link...</p>
      );
    }

    // Invalid nonce
    if (!nonceValid) {
      return (
        <>
          <p className="text-gray-300 text-center mb-6">
            This reset link is invalid or has expired.
          </p>
          <a
            href="/login"
            className="text-sm text-gray-400 hover:text-gray-300 underline text-center"
          >
            Back to login
          </a>
        </>
      );
    }

    // Valid nonce - show new password form
    return (
      <form onSubmit={handleResetSubmit} className="w-full flex flex-col gap-4">
        <p className="text-gray-300 text-center text-sm mb-2">
          Enter a new password for your account.
        </p>
        <Input
          type="password"
          placeholder="New Password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
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
        {resetError && (
          <p className="text-sm text-red-400 text-center">{resetError}</p>
        )}
        <Button
          type="submit"
          className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
          disabled={resetLoading}
        >
          {resetLoading ? "Setting Password..." : "Set New Password"}
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

  // --- Render: request-reset form (no nonce) ---
  if (requestSubmitted) {
    return (
      <>
        <p className="text-gray-300 text-center mb-6">
          If an account exists for that email address, we sent a reset link.
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

  return (
    <form onSubmit={handleRequestSubmit} className="w-full flex flex-col gap-4">
      <p className="text-gray-300 text-center text-sm mb-2">
        Enter your email address and we will send you a reset link.
      </p>
      <Input
        type="email"
        placeholder="Email"
        value={requestEmail}
        onChange={(e) => setRequestEmail(e.target.value)}
        required
        autoComplete="email"
        className="bg-gray-600 border-gray-500 text-white placeholder-gray-400"
      />
      <Button
        type="submit"
        className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
        disabled={requestLoading}
      >
        {requestLoading ? "Sending..." : "Send Reset Link"}
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

function ResetPasswordFallback() {
  return (
    <Button
      className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
      disabled
    >
      Loading...
    </Button>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-500">
      <div className="bg-gray-700 rounded-xl shadow-lg p-8 w-full max-w-md flex flex-col items-center text-white">
        <div className="mb-6">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4">
            <Shield className="w-10 h-10 text-gray-700" />
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-2 text-white">SecureBuild</h1>
        <p className="text-gray-300 mb-8 text-center">Reset Password</p>

        <div className="w-full mb-6">
          <Suspense fallback={<ResetPasswordFallback />}>
            <ResetPasswordContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
