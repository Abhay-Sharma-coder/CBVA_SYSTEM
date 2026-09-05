"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * A SECOND nav, for the admin area only.
 *
 * The primary nav in the app shell stays at four items. Its compact row below
 * `md` is already a horizontal scroller, and adding seven admin destinations to
 * it would push "Floor Map" off the left edge of a phone — which is the thing
 * everybody actually opens the product for.
 *
 * Analytics is first and deliberately so. It is the deliverable; the seat
 * inventory and the outbox are how it is kept honest.
 */
const ITEMS = [
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/seats", label: "Seats" },
  { href: "/admin/users", label: "People" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/floor-plan", label: "Floor plan" },
  { href: "/admin/notifications", label: "Outbox" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/audit", label: "Audit" },
  { href: "/admin/qr", label: "QR sheet" },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-5 border-b border-hairline">
        {ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px block border-b-2 py-2.5 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "border-gold font-medium text-navy"
                    : "border-transparent text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
