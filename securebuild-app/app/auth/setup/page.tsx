"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getSetupState,
  submitSetupEmail,
  resendSetupEmail,
  completeSetup,
  type SetupState,
} from "@/lib/auth/actions/setup";
import { isSmtpConfigured } from "@/lib/auth/actions/auth-config";

// ─── Sub-states ──────────────────────────────────────────────────────────────

type ViewState =
  | { kind: "loading" }
  | { kind: "setup-needed" }
  | { kind: "email-sent"; email: string }
  | { kind: "pending-user"; email: string }
  | { kind: "resent" }
  | { kind: "complete" }
  | { kind: "set-password"; nonce: string }
  | { kind: "error"; message: string };

// ─── Main content (requires useSearchParams) ─────────────────────────────────

function SetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nonce = searchParams.get("nonce");

  const [view, setView] = useState<ViewState>(
    nonce ? { kind: "set-password", nonce } : { kind: "loading" },
  );

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);

  // Check SMTP configuration on mount
  useEffect(() => {
    isSmtpConfigured().then(setSmtpConfigured).catch(() => setSmtpConfigured(false));
  }, []);

  // On mount (when no nonce): determine which setup state we are in
  useEffect(() => {
    if (nonce) return;

    getSetupState()
      .then((result) => {
        const s: SetupState = result.state;
        if (s === "setup-needed") {
          setView({ kind: "setup-needed" });
        } else if (s === "pending-user") {
          setView({
            kind: "pending-user",
            email: result.pendingEmail ?? "",
          });
        } else {
          setView({ kind: "complete" });
        }
      })
      .catch((err) => {
        setView({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to load setup state",
        });
      });
  }, [nonce]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await submitSetupEmail(email);
      setView({ kind: "email-sent", email });
    } catch (err) {
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to send setup email",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setIsSubmitting(true);
    try {
      await resendSetupEmail();
      setView({ kind: "resent" });
    } catch (err) {
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to resend setup email",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setView({
        kind: "error",
        message: "Passwords do not match",
      });
      return;
    }

    if (view.kind !== "set-password") return;

    setIsSubmitting(true);
    try {
      const jwt = await completeSetup(view.nonce, password);

      // Set session cookie — same pattern as login page
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);
      document.cookie = `buildadmin_session=${jwt}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

      router.push("/dashboard");
    } catch (err) {
      setView({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to complete setup",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const renderBody = () => {
    switch (view.kind) {
      case "loading":
        return (
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-300">Loading...</p>
          </div>
        );

      case "setup-needed":
        return (
          <>
            <h1 className="text-3xl font-bold mb-2 text-white">Initial Setup</h1>
            <p className="text-gray-300 mb-8 text-center">
              Enter your email to begin account setup.
            </p>
            <form onSubmit={handleSubmitEmail} className="w-full flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="email" className="text-gray-300">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="bg-gray-600 border-gray-500 text-white placeholder-gray-400"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Sending..." : "Send Setup Email"}
              </Button>
            </form>
          </>
        );

      case "email-sent":
        return (
          <>
            <h1 className="text-3xl font-bold mb-2 text-white">Check your email</h1>
            <p className="text-gray-300 text-center">
              A setup link has been sent to <strong>{view.email}</strong>.
              Follow the link in that email to set your password.
            </p>
          </>
        );

      case "pending-user":
        return (
          <>
            <h1 className="text-3xl font-bold mb-2 text-white">Complete Setup</h1>
            <p className="text-gray-300 mb-6 text-center">
              A setup email was sent to <strong>{view.email}</strong>.
              Check your inbox and follow the link to set your password.
            </p>
            <Button
              className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
              onClick={handleResend}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Sending..." : "Re-send setup email"}
            </Button>
          </>
        );

      case "resent":
        return (
          <>
            <h1 className="text-3xl font-bold mb-2 text-white">Email sent</h1>
            <p className="text-gray-300 text-center">
              A new setup link has been sent. Check your inbox.
            </p>
          </>
        );

      case "complete":
        return (
          <>
            <h1 className="text-3xl font-bold mb-2 text-white">Setup complete</h1>
            <p className="text-gray-300 mb-6 text-center">
              Setup is already complete. Please sign in.
            </p>
            <Button
              className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
              onClick={() => router.push("/login")}
            >
              Go to Sign In
            </Button>
          </>
        );

      case "set-password":
        return (
          <>
            <h1 className="text-3xl font-bold mb-2 text-white">Set Your Password</h1>
            <p className="text-gray-300 mb-8 text-center">
              Choose a password to complete your account setup.
            </p>
            <form onSubmit={handleSetPassword} className="w-full flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="password" className="text-gray-300">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="bg-gray-600 border-gray-500 text-white placeholder-gray-400"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="confirm-password" className="text-gray-300">
                  Confirm Password
                </Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="bg-gray-600 border-gray-500 text-white placeholder-gray-400"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Setting password..." : "Set Password"}
              </Button>
            </form>
          </>
        );

      case "error":
        return (
          <>
            <h1 className="text-3xl font-bold mb-2 text-white">Setup Error</h1>
            <p className="text-red-400 mb-6 text-center">{view.message}</p>
            <Button
              className="w-full bg-white text-gray-800 hover:bg-gray-100 py-3 text-lg font-medium"
              onClick={() => {
                setView(nonce ? { kind: "set-password", nonce } : { kind: "loading" });
                if (!nonce) {
                  getSetupState()
                    .then((result) => {
                      if (result.state === "setup-needed") {
                        setView({ kind: "setup-needed" });
                      } else if (result.state === "pending-user") {
                        setView({ kind: "pending-user", email: result.pendingEmail ?? "" });
                      } else {
                        setView({ kind: "complete" });
                      }
                    })
                    .catch(() => setView({ kind: "setup-needed" }));
                }
              }}
            >
              Try Again
            </Button>
          </>
        );
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-500">
      <div className="bg-gray-700 rounded-xl shadow-lg p-8 w-full max-w-md flex flex-col items-center text-white">
        {/* Logo/Icon */}
        <div className="mb-6">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4">
            <Shield className="w-10 h-10 text-gray-700" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold mb-2 text-white">SecureBuild</h1>
        <p className="text-gray-300 mb-8 text-center">Secure Build Management</p>

        {/* SMTP warning */}
        {smtpConfigured === false && (
          <div className="w-full mb-6 rounded-md bg-yellow-600/20 border border-yellow-500/50 px-4 py-3 text-sm text-yellow-300">
            <strong>Email not configured.</strong> Set <code className="font-mono">SMTP_HOST</code>, <code className="font-mono">SMTP_PORT</code>, <code className="font-mono">SMTP_FROM</code>, and optionally <code className="font-mono">SMTP_USER</code> / <code className="font-mono">SMTP_PASSWORD</code> to enable email sending.
          </div>
        )}

        {/* Content */}
        <div className="w-full">{renderBody()}</div>
      </div>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-500">
      <div className="bg-gray-700 rounded-xl shadow-lg p-8 w-full max-w-md flex flex-col items-center text-white">
        <div className="mb-6">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4">
            <Shield className="w-10 h-10 text-gray-700" />
          </div>
        </div>
        <h1 className="text-3xl font-bold mb-2 text-white">SecureBuild</h1>
        <p className="text-gray-300 mb-8 text-center">Secure Build Management</p>
        <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SetupContent />
    </Suspense>
  );
}
