"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A key figure. Hoisted out of app/page.tsx, where it was a local helper, so
 * the analytics screens and the home page cannot drift apart.
 *
 * THE GOLD RULE LIVES HERE. `accent` is the single key metric per screen — one
 * of exactly three sanctioned uses of gold, alongside the active nav underline
 * and the 2px rule on your own seat. It is a 2px rule under the number, never a
 * fill, and the component takes no `variant` that could become one.
 *
 * If a screen ever renders two accented stats, that is the bug this comment
 * exists to make obvious.
 */
export interface StatProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** The one key metric on this screen. At most one per screen. */
  accent?: boolean;
  /** Rendered small and muted beneath the value — a denominator, usually. */
  of?: React.ReactNode;
  className?: string;
}

export function Stat({ label, value, hint, accent, of, className }: StatProps) {
  return (
    <div className={cn("bg-surface p-4", className)}>
      <dt className="text-[11px] font-medium tracking-wide text-ink-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-1">
        <span
          className={cn(
            "block text-2xl leading-none font-medium tabular text-ink",
            accent && "w-fit border-b-2 border-gold pb-1",
          )}
        >
          {value}
          {of ? (
            <span className="ml-1.5 text-sm font-normal text-ink-subtle">{of}</span>
          ) : null}
        </span>
        {hint ? <span className="mt-2 block text-xs text-ink-muted">{hint}</span> : null}
      </dd>
    </div>
  );
}

/**
 * A row of stats, separated by hairlines rather than boxed individually.
 *
 * The 1px gap over a hairline background is the house trick for a rule between
 * cells that survives wrapping — a border on each cell doubles up at the seams,
 * and a divider utility does not wrap at all.
 */
export function StatRow({
  children,
  className,
  columns = 4,
}: {
  children: React.ReactNode;
  className?: string;
  columns?: 2 | 3 | 4;
}) {
  return (
    <dl
      className={cn(
        "grid gap-px overflow-hidden rounded-md border border-hairline bg-hairline",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </dl>
  );
}
