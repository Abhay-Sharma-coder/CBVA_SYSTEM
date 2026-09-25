"use client";

import { useSession } from "@/components/app-shell/session";

/** Displays the authenticated person; identity can only change by signing in. */
export function RoleSwitcher() {
  const { data, isPending } = useSession();

  if (isPending) {
    return <div className="h-8 w-28 rounded-sm bg-surface-sunken" aria-hidden="true" />;
  }

  if (!data?.user) return null;

  return (
    <span className="max-w-36 truncate text-xs text-ink-muted sm:max-w-52" title={data.user.email}>
      {data.user.displayName}
    </span>
  );
}
