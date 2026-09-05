"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/app-shell/wordmark";
import { RoleSwitcher } from "@/components/app-shell/role-switcher";
import { ClockReadout } from "@/components/app-shell/clock-readout";
import { useSession } from "@/components/app-shell/session";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/floor", label: "Floor Map" },
  { href: "/bookings", label: "My Bookings" },
  { href: "/who", label: "Who's In" },
  { href: "/rooms", label: "Meeting Rooms" },
  { href: "/admin", label: "Admin", adminOnly: true },
] as const;

export function Header() {
  const pathname = usePathname();
  const { data } = useSession();
  const isAdmin = data?.user?.isAdmin ?? false;

  return (
    <header
      data-app-header
      className="sticky top-0 z-40 border-b border-hairline bg-paper/95 backdrop-blur-[2px]"
    >
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Link
          href="/"
          className="shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
        >
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden min-w-0 flex-1 md:block">
          <ul className="flex items-center gap-6">
            {NAV.filter((n) => !("adminOnly" in n && n.adminOnly) || isAdmin).map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "-mb-px inline-block border-b-2 pt-[18px] pb-[15px] text-sm transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy",
                      active
                        ? "border-gold font-medium text-ink"
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

        <div className="ml-auto flex min-w-0 items-center gap-3">
          <ClockReadout />
          <RoleSwitcher />
        </div>
      </div>

      {/* Narrow viewports: nav moves to its own row rather than collapsing into
          a hamburger, because there are only four destinations. */}
      <nav aria-label="Primary, compact" className="border-t border-hairline md:hidden">
        <ul className="mx-auto flex max-w-[1400px] gap-5 overflow-x-auto px-4 sm:px-6">
          {NAV.filter((n) => !("adminOnly" in n && n.adminOnly) || isAdmin).map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-block border-b-2 py-2.5 text-sm whitespace-nowrap",
                    active
                      ? "border-gold font-medium text-ink"
                      : "border-transparent text-ink-muted",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
