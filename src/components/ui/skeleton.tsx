"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The loading placeholder, consolidated.
 *
 * Six screens had hand-rolled copies of the same grey div with slightly
 * different heights and inconsistent aria — one said `role="status"` with a
 * label, one was `aria-hidden`, one was neither, which meant a screen reader's
 * experience of "is this page loading" depended on which page you were on.
 *
 * No shimmer animation. The design language has no gradients (CLAUDE.md), and a
 * moving highlight on eight stacked blocks is exactly the kind of consumer-SaaS
 * texture this product is deliberately not made of. It also has to be disabled
 * again under prefers-reduced-motion, which is two problems for no gain.
 */
export function Skeleton({
  className,
  label,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return (
    <div
      className={cn("rounded-md border border-hairline bg-surface-sunken", className)}
      // Labelled when it stands for a whole panel, silent when it is one of
      // several bars making up a single placeholder — otherwise a screen reader
      // announces "loading" eight times for one screen.
      {...(label
        ? { role: "status", "aria-label": label }
        : { "aria-hidden": "true" as const })}
      {...props}
    />
  );
}

/** A placeholder shaped like a table, for the admin screens. */
export function TableSkeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-px">
      <Skeleton className="h-9 rounded-b-none" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-11 rounded-none",
            i === rows - 1 && "rounded-b-md",
            // A touch of variation so it reads as content rather than a block.
            i % 3 === 1 && "opacity-90",
            i % 3 === 2 && "opacity-80",
          )}
        />
      ))}
    </div>
  );
}
