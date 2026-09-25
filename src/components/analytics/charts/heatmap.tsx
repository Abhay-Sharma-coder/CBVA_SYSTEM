"use client";

/**
 * Bay × weekday occupancy. The visual that makes the argument in one glance.
 *
 * A SEQUENTIAL RAMP, ONE HUE, LIGHT TO DARK. Never a rainbow: a rainbow implies
 * category boundaries where there is only a continuum, and it collapses into
 * mush in greyscale — which is how a partner will print this before a board
 * meeting.
 *
 * THE CELL VALUE IS A MEAN, NOT A SUM. An eight-week range does not contain the
 * same number of Mondays as Fridays, so summing would make one weekday look
 * busier purely because the calendar contained more of it. The API returns
 * `observedDays` per cell for exactly this division.
 *
 * "No data" is a hatched cell, not the lightest step. A bay that was never used
 * and a bay that does not exist on Thursdays are different facts, and giving
 * them the same colour is how a floor plan starts lying.
 */
import * as React from "react";

import { ChartFrame, ChartTooltip, HEAT_STEPS, type TooltipState } from "./chart-frame";

export interface HeatRow {
  key: string;
  label: string;
  /** One per column; null means no observation, which is not zero. */
  values: Array<number | null>;
}

export interface HeatmapProps {
  title: string;
  caption?: React.ReactNode;
  columns: string[];
  rows: HeatRow[];
  unit?: string;
  formatValue?: (v: number) => string;
  /** Fixes the ramp's top so two heat maps can be compared. */
  domainMax?: number;
}

export function Heatmap({
  title,
  caption,
  columns,
  rows,
  unit = "",
  formatValue = (v) => String(Math.round(v * 10) / 10),
  domainMax,
}: HeatmapProps) {
  const [tip, setTip] = React.useState<TooltipState | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(720);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max =
    domainMax ??
    Math.max(1, ...rows.flatMap((r) => r.values.map((v) => v ?? 0)));

  /** Step 0 is reserved for "no data"; real values start at step 1. */
  const stepFor = (v: number | null): string => {
    if (v == null) return HEAT_STEPS[0]!;
    const frac = Math.min(1, v / max);
    const idx = Math.max(1, Math.min(5, Math.ceil(frac * 5)));
    return HEAT_STEPS[idx]!;
  };

  return (
    <ChartFrame
      title={title}
      caption={caption}
      empty={rows.length === 0}
      tableColumns={["Bay", ...columns]}
      tableRows={rows.map((r) => [
        r.label,
        ...r.values.map((v) => (v == null ? "no data" : formatValue(v))),
      ])}
      aside={
        <span className="inline-flex items-center gap-1.5">
          <span className="text-ink-subtle">less</span>
          {HEAT_STEPS.slice(1).map((s, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="inline-block size-3 rounded-sm border border-hairline"
              style={{ backgroundColor: s }}
            />
          ))}
          <span className="text-ink-subtle">more</span>
        </span>
      }
    >
      <div ref={wrapRef} className="relative w-full">
        <table
          // Capped: at full width eleven bays across five days become wide
          // ribbons that read as a bar chart rather than a matrix.
          className="w-full max-w-3xl min-w-[26rem] border-separate"
          style={{ borderSpacing: "2px" }}
        >
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-16 text-left text-[10px] font-medium text-ink-subtle">
                <span className="sr-only">Bay</span>
              </th>
              {columns.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className="pb-1 text-center text-[10px] font-medium text-ink-subtle"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th
                  scope="row"
                  className="seat-code pr-2 text-right text-[10px] font-medium text-ink-muted"
                >
                  {r.label}
                </th>
                {r.values.map((v, i) => (
                  <td
                    key={i}
                    className="h-7 rounded-sm border border-hairline"
                    style={{
                      backgroundColor: stepFor(v),
                      // The same hatch the blocked seat status uses, so "no
                      // information here" reads identically across the product.
                      backgroundImage:
                        v == null
                          ? "repeating-linear-gradient(45deg, var(--cbva-ink-subtle) 0 1px, transparent 1px 5px)"
                          : undefined,
                    }}
                    onMouseMove={(e) => {
                      const box = wrapRef.current?.getBoundingClientRect();
                      if (!box) return;
                      setTip({
                        x: e.clientX - box.left,
                        y: e.clientY - box.top,
                        title: `Bay ${r.label}, ${columns[i]}`,
                        rows: [
                          {
                            label: "Average",
                            value:
                              v == null
                                ? "no data"
                                : `${formatValue(v)}${unit ? ` ${unit}` : ""}`,
                          },
                        ],
                      });
                    }}
                    onMouseLeave={() => setTip(null)}
                  >
                    <span className="sr-only">
                      {r.label} {columns[i]}:{" "}
                      {v == null ? "no data" : `${formatValue(v)} ${unit}`}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <ChartTooltip state={tip} width={width} />
      </div>
    </ChartFrame>
  );
}
