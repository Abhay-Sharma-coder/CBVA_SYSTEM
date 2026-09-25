"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Mail, ArrowRight, CheckCircle2, AlertCircle, KeyRound, UserCheck, ShieldCheck } from "lucide-react";
import { Wordmark } from "@/components/app-shell/wordmark";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [forgotStep, setForgotStep] = useState<"email" | "new_password">("email");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Forgot password step 2 states
  const [resetToken, setResetToken] = useState("");
  const [verifiedUser, setVerifiedUser] = useState<{ displayName: string; email: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetMessage = searchParams.get("reset");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to sign in.");
      }

      await queryClient.invalidateQueries();
      router.push("/floor");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  }

  // Step 1: Verify Email in Database
  async function handleVerifyEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Employee email not found in database.");
      }

      if (data.found && data.resetToken) {
        setResetToken(data.resetToken);
        setVerifiedUser(data.user);
        setForgotStep("new_password");
        setSuccessMessage(`Account verified for ${data.user.displayName}. Create your new password below.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  }

  // Step 2: Reset Password & Auto Sign-In
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      // 1. Reset password in database
      const resetRes = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: resetToken, newPassword }),
      });

      const resetData = await resetRes.json();
      if (!resetRes.ok) {
        throw new Error(resetData.error || "Failed to reset password.");
      }

      // 2. Auto Sign-In with new password
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: newPassword }),
      });

      if (loginRes.ok) {
        await queryClient.invalidateQueries();
        router.push("/floor");
        router.refresh();
      } else {
        setMode("login");
        setPassword(newPassword);
        setSuccessMessage("Password updated successfully! Please sign in with your new password.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleQuickFill(sampleEmail: string) {
    setEmail(sampleEmail);
    setPassword("password123");
    setMode("login");
    setForgotStep("email");
    setError(null);
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      {/* Top logo */}
      <header className="max-w-md mx-auto w-full pt-4 pb-6 text-center">
        <Link href="/" className="inline-block focus-visible:outline-2 focus-visible:outline-navy rounded-sm">
          <Wordmark />
        </Link>
      </header>

      {/* Main card */}
      <main className="max-w-md mx-auto w-full flex-1 flex flex-col justify-center">
        <div className="bg-surface border border-hairline rounded-sm p-6 sm:p-8 shadow-xs">
          {/* Card Header & Tabs */}
          <div className="mb-6">
            <div className="flex border-b border-hairline mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setForgotStep("email");
                  setError(null);
                  setSuccessMessage(null);
                }}
                className={`flex-1 pb-3 text-sm font-medium border-b-2 text-center transition-colors ${
                  mode === "login"
                    ? "border-navy text-navy"
                    : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setForgotStep("email");
                  setError(null);
                  setSuccessMessage(null);
                }}
                className={`flex-1 pb-3 text-sm font-medium border-b-2 text-center transition-colors ${
                  mode === "forgot"
                    ? "border-navy text-navy"
                    : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                Forgot Password
              </button>
            </div>

            <h1 className="text-xl font-serif font-normal text-navy">
              {mode === "login"
                ? "Sign in to CBVA Workspace"
                : forgotStep === "email"
                ? "Forgot Your Password?"
                : "Create New Password"}
            </h1>
            <p className="text-xs text-ink-muted mt-1">
              {mode === "login"
                ? "Enter your firm email and password to access workspace booking & analytics."
                : forgotStep === "email"
                ? "Enter your employee email. The database will verify your account instantly."
                : `Set a new password for ${verifiedUser?.displayName ?? "your account"}.`}
            </p>
          </div>

          {/* Success banner from redirect */}
          {resetMessage === "success" && !successMessage && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-sm flex items-start gap-2">
              <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>Your password has been reset successfully. Please sign in below.</span>
            </div>
          )}

          {/* Alert Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-sm flex items-start gap-2">
              <AlertCircle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Notification */}
          {successMessage && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-sm flex items-start gap-2">
              <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
              <p className="font-medium">{successMessage}</p>
            </div>
          )}

          {/* Mode 1: Sign In Form */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-medium text-ink mb-1">
                  Employee Email
                </label>
                <div className="relative">
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. aarav.agarwal@cbva.in"
                    className="w-full h-10 px-3 pl-9 text-sm bg-surface border border-hairline rounded-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy text-ink placeholder:text-ink-subtle"
                  />
                  <Mail className="absolute left-3 top-2.5 size-4 text-ink-subtle pointer-events-none" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="password" className="block text-xs font-medium text-ink">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgot");
                      setForgotStep("email");
                      setError(null);
                    }}
                    className="text-xs text-navy hover:underline focus:outline-none"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-10 px-3 pl-9 text-sm bg-surface border border-hairline rounded-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy text-ink placeholder:text-ink-subtle"
                  />
                  <Lock className="absolute left-3 top-2.5 size-4 text-ink-subtle pointer-events-none" />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-10 mt-2 bg-navy hover:bg-navy/90 text-white font-medium text-sm rounded-sm transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <span>Signing in…</span>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Mode 2 Step 1: Forgot Password - Verify Email */}
          {mode === "forgot" && forgotStep === "email" && (
            <form onSubmit={handleVerifyEmail} className="space-y-4">
              <div>
                <label htmlFor="forgot-email" className="block text-xs font-medium text-ink mb-1">
                  Employee Email Address
                </label>
                <div className="relative">
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. aarav.agarwal@cbva.in"
                    className="w-full h-10 px-3 pl-9 text-sm bg-surface border border-hairline rounded-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy text-ink placeholder:text-ink-subtle"
                  />
                  <Mail className="absolute left-3 top-2.5 size-4 text-ink-subtle pointer-events-none" />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-10 mt-2 bg-navy hover:bg-navy/90 text-white font-medium text-sm rounded-sm transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <span>Verifying Account…</span>
                ) : (
                  <>
                    <ShieldCheck className="size-4" />
                    <span>Verify Account & Reset Password</span>
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                  className="text-xs text-navy hover:underline focus:outline-none"
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          )}

          {/* Mode 2 Step 2: Forgot Password - Create New Password */}
          {mode === "forgot" && forgotStep === "new_password" && verifiedUser && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="p-3 bg-surface-sunken border border-hairline text-xs rounded-sm text-ink mb-2">
                <p className="font-medium text-navy">Account Verified:</p>
                <p>{verifiedUser.displayName} ({verifiedUser.email})</p>
              </div>

              <div>
                <label htmlFor="newPassword" className="block text-xs font-medium text-ink mb-1">
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="newPassword"
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter at least 6 characters"
                    className="w-full h-10 px-3 pl-9 text-sm bg-surface border border-hairline rounded-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy text-ink placeholder:text-ink-subtle"
                  />
                  <Lock className="absolute left-3 top-2.5 size-4 text-ink-subtle pointer-events-none" />
                </div>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-xs font-medium text-ink mb-1">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full h-10 px-3 pl-9 text-sm bg-surface border border-hairline rounded-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy text-ink placeholder:text-ink-subtle"
                  />
                  <Lock className="absolute left-3 top-2.5 size-4 text-ink-subtle pointer-events-none" />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-10 mt-2 bg-navy hover:bg-navy/90 text-white font-medium text-sm rounded-sm transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <span>Updating Password…</span>
                ) : (
                  <>
                    <KeyRound className="size-4" />
                    <span>Update Password & Sign In</span>
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setForgotStep("email");
                    setError(null);
                  }}
                  className="text-xs text-navy hover:underline focus:outline-none"
                >
                  ← Back to Email Input
                </button>
              </div>
            </form>
          )}

          {/* Employee Quick Login Affordances */}
          <div className="mt-8 pt-6 border-t border-hairline">
            <div className="flex items-center gap-1.5 mb-3 text-xs font-medium text-ink-muted">
              <UserCheck className="size-3.5 text-gold" />
              <span>Sample Employee Accounts</span>
            </div>
            <p className="text-[11px] text-ink-subtle mb-3">
              Click any employee email to fill credentials:
            </p>

            <div className="grid grid-cols-1 gap-1.5">
              <button
                type="button"
                onClick={() => handleQuickFill("aarav.agarwal@cbva.in")}
                className="text-left px-2.5 py-1.5 text-xs rounded-sm border border-hairline hover:bg-surface-sunken flex items-center justify-between transition-colors cursor-pointer"
              >
                <span className="font-mono text-navy">aarav.agarwal@cbva.in</span>
                <span className="text-[10px] text-ink-muted bg-paper px-1.5 py-0.5 rounded border border-hairline">Partner (Admin)</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickFill("chirag.mukherjee@cbva.in")}
                className="text-left px-2.5 py-1.5 text-xs rounded-sm border border-hairline hover:bg-surface-sunken flex items-center justify-between transition-colors cursor-pointer"
              >
                <span className="font-mono text-navy">chirag.mukherjee@cbva.in</span>
                <span className="text-[10px] text-ink-muted bg-paper px-1.5 py-0.5 rounded border border-hairline">Manager</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickFill("rohan.kumar@cbva.in")}
                className="text-left px-2.5 py-1.5 text-xs rounded-sm border border-hairline hover:bg-surface-sunken flex items-center justify-between transition-colors cursor-pointer"
              >
                <span className="font-mono text-navy">rohan.kumar@cbva.in</span>
                <span className="text-[10px] text-ink-muted bg-paper px-1.5 py-0.5 rounded border border-hairline">Article Trainee</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-md mx-auto w-full py-4 text-center text-xs text-ink-subtle">
        CBV & Associates LLP — Office Capacity & Desk Booking System
      </footer>
    </div>
  );
}
