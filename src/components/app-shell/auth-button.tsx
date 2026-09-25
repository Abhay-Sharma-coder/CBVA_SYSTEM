"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn, LogOut } from "lucide-react";
import { useSession } from "@/components/app-shell/session";
import { GRADE_LABEL } from "@/lib/seed-data/inventory";
import type { Grade } from "@/lib/db/schema";

export function AuthButton() {
  const { data, isPending } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      await queryClient.invalidateQueries();
      router.push("/auth/login");
      router.refresh();
    } catch (err) {
      console.error("Logout failed", err);
    }
  }

  if (isPending) {
    return (
      <div
        className="h-8 w-28 rounded-sm border border-hairline bg-surface-sunken"
        aria-hidden="true"
      />
    );
  }

  if (data?.user) {
    const gradeLabel = GRADE_LABEL[data.user.grade as Grade] ?? data.user.grade;

    return (
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex flex-col text-right text-xs leading-tight">
          <span className="font-medium text-ink truncate max-w-[150px]">
            {data.user.displayName}
          </span>
          <span className="text-[10px] text-ink-muted">
            {gradeLabel}{data.user.isAdmin ? " (Admin)" : ""}
          </span>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          title={`Signed in as ${data.user.displayName} (${data.user.email}). Click to Sign Out.`}
          className="h-8 px-2.5 text-xs font-medium text-ink-muted hover:text-navy border border-hairline bg-surface hover:bg-surface-sunken rounded-sm transition-colors flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-navy cursor-pointer"
        >
          <LogOut className="size-3.5 text-ink-subtle" />
          <span>Sign Out</span>
        </button>
      </div>
    );
  }

  return (
    <Link
      href="/auth/login"
      className="h-8 px-3 text-xs font-medium text-white bg-navy hover:bg-navy/90 rounded-sm transition-colors flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-navy"
    >
      <LogIn className="size-3.5" />
      <span>Sign In</span>
    </Link>
  );
}
