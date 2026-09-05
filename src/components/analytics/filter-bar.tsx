"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/primitives";
import { useClock } from "@/components/app-shell/session";
import { MEASURES, MEASURE_KEYS, type MeasureKey } from "@/lib/analytics/measures";

/**
 * The filters, in one row above the charts, with the state in the URL.
 *
 * IN THE URL, not in a store, for the same reason the floor plan's date and
 * slot are: "look at zone C over the last fortnight" has to be a link somebody
 * can paste into an email. A partner asking a question and an analyst answering
 * it should be looking at the same screen, and that is a property of the
 * address bar rather than of anybody remembering to describe their filters.
 *
 * The exports read the same query string, so a downloaded CSV cannot disagree
 * with the chart it came from.
 */
export interface FilterOptions {
  zones: Array<{ code: string; displayName: string }>;
  bays: string[];
  teams: string[];
}

export interface FilterBarProps {
  options?: FilterOptions;
  slots: Array<{ key: string; label: string }>;
  /** Ranges are only meaningful on Trends; Today and Forecast fix their own. */
  showRange?: boolean;
  showMeasure?: boolean;
  showExport?: boolean;
  busy?: boolean;
}

const RANGES = [
  { key: "14", label: "Last 2 weeks" },
  { key: "28", label: "Last 4 weeks" },
  { key: "56", label: "Last 8 weeks" },
  { key: "182", label: "Last 6 months" },
] as const;

export function FilterBar({
  options,
  slots,
  showRange = true,
  showMeasure = true,
  showExport = true,
  busy,
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const clock = useClock();

  const set = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const measure = (params.get("measure") as MeasureKey | null) ?? "booked";

  /**
   * "Today" comes from the shared clock, never the browser's.
   *
   * Caught by the eslint rule, and it was a real bug rather than a formality:
   * with the demo clock advanced two days, a browser-derived range would end
   * before the data the rest of the screen is showing, and the charts would
   * quietly lose their most recent points mid-demo.
   */
  const applyRange = (days: string) => {
    const to = clock.data?.now ? new Date(clock.data.now) : null;
    if (!to) return;
    const from = new Date(to.getTime() - Number(days) * 86_400_000);
    set({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
  };

  const activeRange = (() => {
    const from = params.get("from");
    const to = params.get("to");
    if (!from || !to) return "56";
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
    return RANGES.find((r) => Math.abs(Number(r.key) - days) <= 1)?.key ?? "custom";
  })();

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-md border border-hairline bg-surface p-3">
      {showRange ? (
        <label className="min-w-0 text-xs">
          <span className="mb-1 block font-medium text-ink-subtle">Range</span>
          <Select
            className="w-40"
            value={activeRange}
            onChange={(e) => applyRange(e.target.value)}
            disabled={busy}
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
            {activeRange === "custom" ? <option value="custom">Custom</option> : null}
          </Select>
        </label>
      ) : null}

      <label className="min-w-0 text-xs">
        <span className="mb-1 block font-medium text-ink-subtle">Zone</span>
        <Select
          className="w-36"
          value={params.get("zone") ?? ""}
          onChange={(e) => set({ zone: e.target.value || null, bay: null })}
          disabled={busy}
        >
          <option value="">Whole floor</option>
          {options?.zones.map((z) => (
            <option key={z.code} value={z.code}>
              Zone {z.code}
            </option>
          ))}
        </Select>
      </label>

      <label className="min-w-0 text-xs">
        <span className="mb-1 block font-medium text-ink-subtle">Bay</span>
        <Select
          className="w-28"
          value={params.get("bay") ?? ""}
          onChange={(e) => set({ bay: e.target.value || null })}
          disabled={busy}
        >
          <option value="">All bays</option>
          {options?.bays.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
      </label>

      <label className="min-w-0 text-xs">
        <span className="mb-1 block font-medium text-ink-subtle">Team</span>
        <Select
          className="w-44"
          value={params.get("team") ?? ""}
          onChange={(e) => set({ team: e.target.value || null })}
          disabled={busy}
        >
          <option value="">All teams</option>
          {options?.teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </label>

      <label className="min-w-0 text-xs">
        <span className="mb-1 block font-medium text-ink-subtle">Slot</span>
        <Select
          className="w-32"
          value={params.get("slot") ?? ""}
          onChange={(e) => set({ slot: e.target.value || null })}
          disabled={busy}
        >
          <option value="">Both slots</option>
          {slots.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>
      </label>

      {showMeasure ? (
        <label className="min-w-0 text-xs">
          <span className="mb-1 block font-medium text-ink-subtle">Measure</span>
          <Select
            className="w-44"
            value={measure}
            onChange={(e) => set({ measure: e.target.value })}
            disabled={busy}
          >
            {MEASURE_KEYS.map((k) => (
              <option key={k} value={k}>
                {MEASURES[k].label}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      <div className="ms-auto flex items-end gap-2">
        {showExport ? (
          <>
            {(
              [
                ["bookings", "Bookings"],
                ["occupancy", "Occupancy"],
                ["utilisation", "Per desk"],
              ] as const
            ).map(([kind, label]) => (
              <Button key={kind} asChild size="sm" variant="ghost">
                <a
                  href={`/api/admin/analytics/export?kind=${kind}&${params.toString()}`}
                  // The filters on screen ARE the export's filters, because
                  // both sides read this same query string.
                  download
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  {label}
                  <span className="sr-only"> CSV, for the current filters</span>
                </a>
              </Button>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The explainer that sits beside the three measures.
 *
 * The auto-release accounting question is OPEN with CBVA, and this component is
 * how the product declines to answer it for them: all three definitions on
 * screen, in the words a partner would use, with what each one does NOT tell
 * you. A number whose definition is not next to it is a number somebody will
 * quote wrongly in a board pack.
 */
export function MeasureExplainer({ measure }: { measure: MeasureKey }) {
  return (
    <div className="rounded-md border border-hairline bg-surface-sunken p-3">
      <h3 className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
        What these numbers mean
      </h3>
      <dl className="mt-2 grid gap-3 sm:grid-cols-3">
        {MEASURE_KEYS.map((k) => {
          const m = MEASURES[k];
          const active = k === measure;
          return (
            <div
              key={k}
              className={
                active
                  ? "border-l-2 border-navy pl-2.5"
                  : "border-l-2 border-transparent pl-2.5"
              }
            >
              <dt className="text-xs font-medium text-ink">
                {m.label}
                {active ? <span className="sr-only"> (currently shown)</span> : null}
              </dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                {m.counts}{" "}
                <span className="text-ink-subtle">{m.caveat}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 border-t border-hairline pt-2 text-xs text-ink-subtle">
        CBVA has not yet decided which of these should be the headline figure, so
        all three are shown side by side rather than one being chosen for you.
        The difference between them is itself a finding.
      </p>
    </div>
  );
}
