"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Lock, KeyRound, CheckCircle2, AlertCircle, ArrowRight, User } from "lucide-react";
import { Wordmark } from "@/components/app-shell/wordmark";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialToken = searchParams.get("token") || "";

  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [isVerifying, setIsVerifying] = useState(false);
  const [userInfo, setUserInfo] = useState<{ displayName: string; email: string } | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    if (!token.trim()) return;

    let isMounted = true;
    setIsVerifying(true);
    setTokenError(null);

    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token.trim())}`)
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.valid && data.user) {
          setUserInfo(data.user);
          setTokenError(null);
        } else {
          setUserInfo(null);
          setTokenError(data.error || "Invalid or expired reset token.");
        }
      })
      .catch(() => {
        if (isMounted) setTokenError("Could not verify reset token.");
      })
      .finally(() => {
        if (isMounted) setIsVerifying(false);
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
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

    if (!token.trim()) {
      setError("Reset token is required.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password.");
      }

      setIsDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred.");
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
              Create New Password
            </h1>
            <p className="text-xs text-ink-muted mt-1">
              {userInfo
                ? `Resetting password for ${userInfo.displayName} (${userInfo.email})`
                : "Enter your reset token and your new account password below."}
            </p>
          </div>

          {userInfo && (
            <div className="mb-4 p-3 bg-surface-sunken border border-hairline text-xs rounded-sm flex items-center gap-2 text-ink">
              <User className="size-4 text-navy shrink-0" />
              <span>Account: <strong>{userInfo.displayName}</strong> ({userInfo.email})</span>
            </div>
          )}

          {tokenError && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-sm flex items-start gap-2">
              <AlertCircle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{tokenError}</span>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-sm flex items-start gap-2">
              <AlertCircle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isDone ? (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-sm flex items-start gap-3">
                <CheckCircle2 className="size-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium text-sm text-emerald-950 mb-1">Password Reset Complete</h3>
                  <p>Your account password has been updated. You can now sign in with your new password.</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => router.push("/auth/login?reset=success")}
                className="w-full h-10 mt-2 bg-navy hover:bg-navy/90 text-white font-medium text-sm rounded-sm transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy cursor-pointer"
              >
                <span>Proceed to Sign In</span>
                <ArrowRight className="size-4" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="token" className="block text-xs font-medium text-ink mb-1">
                  Reset Token
                </label>
                <div className="relative">
                  <input
                    id="token"
                    type="text"
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Enter or paste token"
                    className="w-full h-10 px-3 pl-9 text-xs font-mono bg-surface border border-hairline rounded-sm focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy text-ink placeholder:text-ink-subtle"
                  />
                  <KeyRound className="absolute left-3 top-2.5 size-4 text-ink-subtle pointer-events-none" />
                </div>
                {isVerifying && (
                  <p className="text-[11px] text-ink-subtle mt-1">Verifying token…</p>
                )}
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
                    placeholder="At least 6 characters"
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
                disabled={isLoading || isVerifying || !!tokenError}
                className="w-full h-10 mt-2 bg-navy hover:bg-navy/90 text-white font-medium text-sm rounded-sm transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <span>Updating Password…</span>
                ) : (
                  <>
                    <span>Reset Password</span>
                    <ArrowRight className="size-4" />
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <Link href="/auth/login" className="text-xs text-navy hover:underline">
                  Back to Sign In
                </Link>
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
