"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, KeyRound, CheckCircle2, AlertCircle, ArrowLeft, ShieldCheck } from "lucide-react";
import { Wordmark } from "@/components/app-shell/wordmark";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"email" | "new_password">("email");

  const [email, setEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [verifiedUser, setVerifiedUser] = useState<{ displayName: string; email: string } | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Check Email in Database
  async function handleVerifyEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
        setStep("new_password");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  }

  // Step 2: Reset Password & Auto Log in
  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

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
        router.push("/auth/login?reset=success");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      <header className="max-w-md mx-auto w-full pt-4 pb-6 text-center">
        <Link href="/" className="inline-block focus-visible:outline-2 focus-visible:outline-navy rounded-sm">
          <Wordmark />
        </Link>
      </header>

      <main className="max-w-md mx-auto w-full flex-1 flex flex-col justify-center">
        <div className="bg-surface border border-hairline rounded-sm p-6 sm:p-8 shadow-xs">
          <div className="mb-6">
            <h1 className="text-xl font-serif font-normal text-navy">
              {step === "email" ? "Reset Your Password" : "Create New Password"}
            </h1>
            <p className="text-xs text-ink-muted mt-1">
              {step === "email"
                ? "Enter your registered employee email address. The database will verify your account."
                : `Set a new password for ${verifiedUser?.displayName ?? "your account"}.`}
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-sm flex items-start gap-2">
              <AlertCircle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {step === "email" ? (
            <form onSubmit={handleVerifyEmail} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-medium text-ink mb-1">
                  Employee Email Address
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
                    <span>Verify Email & Create Password</span>
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <Link
                  href="/auth/login"
                  className="inline-flex items-center gap-1.5 text-xs text-navy hover:underline"
                >
                  <ArrowLeft className="size-3.5" />
                  <span>Back to Sign In</span>
                </Link>
              </div>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="p-3 bg-surface-sunken border border-hairline text-xs rounded-sm text-ink mb-2">
                <p className="font-medium text-navy">Account Verified:</p>
                <p>{verifiedUser?.displayName} ({verifiedUser?.email})</p>
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
                    setStep("email");
                    setError(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs text-navy hover:underline focus:outline-none"
                >
                  <ArrowLeft className="size-3.5" />
                  <span>Back to Email Input</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </main>

      <footer className="max-w-md mx-auto w-full py-4 text-center text-xs text-ink-subtle">
        CBV & Associates LLP — Office Capacity & Desk Booking System
      </footer>
    </div>
  );
}
