"use client";

/**
 * The shell every chart in this product is drawn inside.
 *
 * WHY HAND-ROLLED SVG AND NOT A CHART LIBRARY. Three reasons, in order of how
 * much they cost to work around: the stack is pinned deliberately and a chart
 * library is a large runtime dependency for four chart types; every library
 * ships rounded corners, drop shadows and its own type scale, all of which have
 * to be fought token by token in a design system whose whole thesis is
 * hairlines and 4px radii; and a partner is going to PRINT these, which means
 * greyscale legibility is a requirement rather than a nicety.
 *
 * THE ACCESSIBILITY CONTRACT, held here so no individual chart can forget it:
 *
 *  1. Every chart carries a `<table class="sr-only">` of its own data. A screen
 *     reader gets the numbers, not a shrug — and the same table is what makes
 *     the figure legible when colour fails.
 *  2. Two or more series always get a legend. Identity is never colour alone,
 *     which is the same rule the seat statuses have followed since Phase 1.
 *  3. The SVG is `role="img"` with a real label, never `role="application"`.
 *     Phase 4 took the same position for the 3D view (ADR-032): claiming an
 *     interactive role you cannot deliver is worse than not claiming it.
 */
import * as React from "react";

import { cn } from "@/lib/utils";

export interface Series {
  key: string;
  label: string;
  /** A CSS colour, always from a token. No hex values in chart code. */
  color: string;
  /** Non-colour differentiator, for greyscale and colour-vision deficiency. */
  glyph?: string;
}

export interface ChartFrameProps {
  title: string;
  /** What the reader should take from it. Optional but usually worth a line. */
  caption?: React.ReactNode;
  /** Drawn only when there are two or more series. */
  series?: Series[];
  /** Column headers for the screen-reader table. */
  tableColumns: string[];
  /** One row per data point, already formatted for reading aloud. */
  tableRows: Array<Array<string | number>>;
  /** Rendered when there is nothing to draw. */
  empty?: boolean;
  emptyMessage?: string;
  height?: number;
  className?: string;
  children?: React.ReactNode;
  /** Shown at the top right — usually a unit or a total. */
  aside?: React.ReactNode;
}

export function ChartFrame({
  title,
  caption,
  series,
  tableColumns,
  tableRows,
  empty,
  emptyMessage = "No bookings in this range yet.",
  className,
  children,
  aside,
}: ChartFrameProps) {
  const id = React.useId();

  return (
    <figure className={cn("min-w-0", className)}>
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        {aside ? <span className="text-xs text-ink-subtle tabular">{aside}</span> : null}
        {caption ? (
          <p className="w-full text-xs leading-relaxed text-ink-muted">{caption}</p>
        ) : null}
      </figcaption>

      {series && series.length > 1 ? (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5" aria-label={`${title} legend`}>
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span
                aria-hidden="true"
                className="inline-flex size-3 shrink-0 items-center justify-center rounded-sm text-[8px] leading-none text-paper"
                style={{ backgroundColor: s.color }}
              >
                {s.glyph ?? ""}
              </span>
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}

      {empty ? (
        <div
          className="flex h-40 items-center justify-center rounded-md border border-dashed border-hairline px-4 text-center text-sm text-ink-subtle"
          role="status"
        >
          {emptyMessage}
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto">{children}</div>
      )}

      {/*
        The same numbers, for a screen reader and for anybody who cannot use the
        colours. Not a fallback — it is always present and always correct,
        because it is rendered from the same array the marks are.
      */}
      <table className="sr-only" id={`${id}-table`}>
        <caption>{title}</caption>
        <thead>
          <tr>
            {tableColumns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={j}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/* ------------------------------------------------------------------ scales */

/** A linear scale from a data domain to a pixel range. */
export function scaleLinear(domainMax: number, rangePx: number) {
  const max = domainMax > 0 ? domainMax : 1;
  return (v: number) => (v / max) * rangePx;
}

/**
 * "Nice" axis ticks — 0, then round steps up to at least the maximum.
 *
 * Worth doing properly rather than dividing the max by four: an axis reading
 * 0 / 17.25 / 34.5 makes a reader do arithmetic to check a bar, which is
 * exactly the friction that stops somebody trusting a number.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.001; t += step) ticks.push(Number(t.toFixed(6)));
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/**
 * Three or more series, assigned in this order and never cycled.
 *
 * The order is blue, amber, green, red because the CVD checks are on ADJACENT
 * pairs and amber beside red fails the normal-vision floor at ΔE 12.7 — two
 * series a full-colour reader cannot reliably separate. With green between
 * them every check passes. Reordering these is not a style choice.
 */
export const CHART_SERIES_COLORS = [
  "var(--cbva-chart-2)",
  "var(--cbva-chart-1)",
  "var(--cbva-chart-3)",
  "var(--cbva-chart-4)",
] as const;

/**
 * EXACTLY TWO series — which is most of this product, because most charts are
 * split by slot and there are two slots.
 *
 * Blue and green rather than the first two of the ordered list, for two
 * reasons. They separate far better than any other pair here (ΔE 25.0 normal,
 * 24.5 protan against 9.8 for blue/amber), and it keeps amber off the charts
 * that carry the largest filled areas. Amber is not gold — it is darker and
 * browner — but a bar chart is the easiest place in a product to accidentally
 * spend 40% of the pixels on something a partner will read as gold, and the
 * gold rule exists precisely to stop that.
 */
export const CHART_PAIR = ["var(--cbva-chart-2)", "var(--cbva-chart-3)"] as const;

/** The palette for `n` series, snapped to the validated set. */
export function seriesColors(n: number): readonly string[] {
  return n === 2 ? CHART_PAIR : CHART_SERIES_COLORS;
}

/** Sequential ramp for magnitude. Index 0 means "no data", not "zero". */
export const HEAT_STEPS = [
  "var(--cbva-heat-0)",
  "var(--cbva-heat-1)",
  "var(--cbva-heat-2)",
  "var(--cbva-heat-3)",
  "var(--cbva-heat-4)",
  "var(--cbva-heat-5)",
] as const;

/* ----------------------------------------------------------------- tooltip */

export interface TooltipState {
  x: number;
  y: number;
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
}

/**
 * The hover layer. An SVG chart in a browser IS interactive, so a tooltip is
 * the default rather than an enhancement.
 *
 * Positioned in the container's own coordinates and flipped near the right
 * edge, because the rightmost column is the most recent day and therefore the
 * one people hover most.
 */
export function ChartTooltip({ state, width }: { state: TooltipState | null; width: number }) {
  if (!state) return null;
  const flip = state.x > width * 0.6;

  return (
    <div
      role="tooltip"
      aria-hidden="true"
      className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-hairline bg-surface px-2.5 py-2 text-xs shadow-hairline"
      style={{
        left: flip ? undefined : state.x + 12,
        right: flip ? width - state.x + 12 : undefined,
        top: Math.max(0, state.y - 12),
      }}
    >
      <p className="mb-1 font-medium text-ink">{state.title}</p>
      <dl className="space-y-0.5">
        {state.rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-ink-muted">
              {r.color ? (
                <span
                  aria-hidden="true"
                  className="inline-block size-2 shrink-0 rounded-sm"
                  style={{ backgroundColor: r.color }}
                />
              ) : null}
              {r.label}
            </dt>
            <dd className="tabular font-medium text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
