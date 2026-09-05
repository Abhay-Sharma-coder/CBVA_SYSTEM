"use client";

/**
 * Grouped bars, for magnitude by category.
 *
 * Marks are anchored to the baseline with 4px rounded data-ends only, so a bar
 * reads as a quantity growing from zero rather than a floating pill. Adjacent
 * bars in a group carry a 2px paper gap, which is what stops two series merging
 * into one shape at small sizes and in greyscale.
 *
 * A reference line (capacity) is drawn as a dashed rule with a direct label
 * rather than as a fifth series: capacity is the thing the bars are measured
 * AGAINST, and giving it the same visual weight invites somebody to read it as
 * another quantity to add up.
 */
import * as React from "react";

import {
  ChartFrame,
  ChartTooltip,
  niceTicks,
  type Series,
  type TooltipState,
} from "./chart-frame";

export interface BarDatum {
  key: string;
  label: string;
  /** One value per series, in the same order as `series`. */
  values: number[];
  /** Optional dashed reference, e.g. capacity for that day. */
  reference?: number | null;
}

export interface BarChartProps {
  title: string;
  caption?: React.ReactNode;
  aside?: React.ReactNode;
  series: Series[];
  data: BarDatum[];
  /** Appended to tooltip values, e.g. "desks". */
  unit?: string;
  referenceLabel?: string;
  height?: number;
  /** Rotate x labels when there are many categories. */
  dense?: boolean;
  formatValue?: (v: number) => string;
}

const PAD = { top: 8, right: 8, bottom: 28, left: 36 };
/** Rotated labels need roughly twice the gutter, or they clip at the frame. */
const DENSE_BOTTOM = 54;

export function BarChart({
  title,
  caption,
  aside,
  series,
  data,
  unit = "",
  referenceLabel = "Capacity",
  height = 220,
  dense = false,
  formatValue = (v) => String(Math.round(v * 10) / 10),
}: BarChartProps) {
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

  const maxValue = Math.max(
    1,
    ...data.flatMap((d) => [...d.values, d.reference ?? 0]),
  );
  const ticks = niceTicks(maxValue);
  const domainMax = ticks[ticks.length - 1] ?? 1;

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const bottom = dense ? DENSE_BOTTOM : PAD.bottom;
  const plotH = Math.max(1, height - PAD.top - bottom);
  const bandW = plotW / Math.max(1, data.length);
  // 2px between bars in a group, and a quarter band of air between groups.
  const groupW = bandW * 0.74;
  const barW = Math.max(2, (groupW - (series.length - 1) * 2) / series.length);
  const y = (v: number) => plotH - (v / domainMax) * plotH;

  const empty = data.length === 0 || data.every((d) => d.values.every((v) => v === 0));

  return (
    <ChartFrame
      title={title}
      caption={caption}
      aside={aside}
      series={series}
      empty={empty}
      tableColumns={[
        "Category",
        ...series.map((s) => s.label),
        ...(data.some((d) => d.reference != null) ? [referenceLabel] : []),
      ]}
      tableRows={data.map((d) => [
        d.label,
        ...d.values.map(formatValue),
        ...(data.some((x) => x.reference != null) ? [d.reference ?? "—"] : []),
      ])}
    >
      <div ref={wrapRef} className="relative w-full">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}. ${data.length} categories.`}
          onMouseLeave={() => setTip(null)}
        >
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {/* Grid first, so every mark sits on top of it. */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={0}
                  x2={plotW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--cbva-grid)"
                  strokeWidth={1}
                />
                <text
                  x={-6}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-ink-subtle text-[10px] tabular"
                >
                  {t}
                </text>
              </g>
            ))}

            {data.map((d, i) => {
              const x0 = i * bandW + (bandW - groupW) / 2;
              return (
                <g key={d.key}>
                  {/* A full-height hover target: a 6px bar is not a hit area. */}
                  <rect
                    x={i * bandW}
                    y={0}
                    width={bandW}
                    height={plotH}
                    fill="transparent"
                    onMouseMove={(e) => {
                      const box = wrapRef.current?.getBoundingClientRect();
                      if (!box) return;
                      setTip({
                        x: e.clientX - box.left,
                        y: e.clientY - box.top,
                        title: d.label,
                        rows: [
                          ...series.map((s, si) => ({
                            label: s.label,
                            value: `${formatValue(d.values[si] ?? 0)}${unit ? ` ${unit}` : ""}`,
                            color: s.color,
                          })),
                          ...(d.reference != null
                            ? [{ label: referenceLabel, value: String(d.reference) }]
                            : []),
                        ],
                      });
                    }}
                  />
                  {series.map((s, si) => {
                    const v = d.values[si] ?? 0;
                    const h = Math.max(v > 0 ? 1 : 0, plotH - y(v));
                    return (
                      <rect
                        key={s.key}
                        x={x0 + si * (barW + 2)}
                        y={plotH - h}
                        width={barW}
                        height={h}
                        rx={Math.min(4, barW / 2)}
                        fill={s.color}
                        className="pointer-events-none"
                      />
                    );
                  })}
                  {d.reference != null ? (
                    <line
                      x1={i * bandW + 2}
                      x2={i * bandW + bandW - 2}
                      y1={y(d.reference)}
                      y2={y(d.reference)}
                      stroke="var(--cbva-ink-subtle)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      className="pointer-events-none"
                    />
                  ) : null}
                </g>
              );
            })}

            {/* Baseline last, so bars sit ON it rather than under it. */}
            <line
              x1={0}
              x2={plotW}
              y1={plotH}
              y2={plotH}
              stroke="var(--cbva-hairline)"
              strokeWidth={1}
            />

            {data.map((d, i) => (
              <text
                key={d.key}
                x={i * bandW + bandW / 2}
                y={plotH + 16}
                textAnchor={dense ? "end" : "middle"}
                transform={
                  dense
                    ? `rotate(-40 ${i * bandW + bandW / 2} ${plotH + 16})`
                    : undefined
                }
                className="fill-ink-subtle text-[10px]"
              >
                {d.label}
              </text>
            ))}
          </g>
        </svg>
        <ChartTooltip state={tip} width={width} />
      </div>
    </ChartFrame>
  );
}
