"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Three routes rather than three tabs on one page, so a view is a link.
 *
 * The filters ride the query string with them: "look at Zone C's forecast" is
 * something somebody can paste into an email, which is the same reason the
 * floor plan puts its date and slot in the URL.
 */
const VIEWS = [
  { href: "/admin/analytics/today", label: "Today" },
  { href: "/admin/analytics/forecast", label: "Forecast" },
  { href: "/admin/analytics", label: "Trends" },
] as const;

export function AnalyticsTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const qs = params.toString();

  return (
    <nav aria-label="Analytics views">
      <ul className="flex gap-1 rounded-md border border-hairline bg-surface-sunken p-1">
        {VIEWS.map((v) => {
          const active = pathname === v.href;
          return (
            <li key={v.href}>
              <Link
                href={qs ? `${v.href}?${qs}` : v.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-sm px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-surface font-medium text-navy shadow-hairline"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {v.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
