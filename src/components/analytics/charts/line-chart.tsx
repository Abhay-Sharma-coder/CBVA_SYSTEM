"use client";

/**
 * Lines over time, with a crosshair.
 *
 * ONE AXIS, ALWAYS. Desks and seat-hours are different scales and there is a
 * standing temptation to put both on one chart with a second y-axis — which
 * makes the crossing point of the two lines meaningful when it is an artefact
 * of two arbitrary scalings. When two measures have to be compared they get two
 * charts, or they get indexed to a common base.
 *
 * A capacity band is drawn behind the lines rather than as another series, for
 * the same reason the bar chart dashes it: capacity is the thing being measured
 * against, not another quantity in the same stack.
 */
import * as React from "react";

import {
  ChartFrame,
  ChartTooltip,
  niceTicks,
  type Series,
  type TooltipState,
} from "./chart-frame";

export interface LinePoint {
  key: string;
  label: string;
  values: Array<number | null>;
}

export interface LineChartProps {
  title: string;
  caption?: React.ReactNode;
  aside?: React.ReactNode;
  series: Series[];
  data: LinePoint[];
  unit?: string;
  /** A horizontal reference, e.g. the bookable pool. */
  reference?: { value: number; label: string } | null;
  height?: number;
  /** Show at most this many x labels; the rest are ticks only. */
  maxLabels?: number;
  formatValue?: (v: number) => string;
}

const PAD = { top: 10, right: 12, bottom: 26, left: 36 };

export function LineChart({
  title,
  caption,
  aside,
  series,
  data,
  unit = "",
  reference = null,
  height = 240,
  maxLabels = 8,
  formatValue = (v) => String(Math.round(v * 10) / 10),
}: LineChartProps) {
  const [tip, setTip] = React.useState<TooltipState | null>(null);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
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
    reference?.value ?? 0,
    ...data.flatMap((d) => d.values.map((v) => v ?? 0)),
  );
  const ticks = niceTicks(maxValue);
  const domainMax = ticks[ticks.length - 1] ?? 1;

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = Math.max(1, height - PAD.top - PAD.bottom);
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;
  const x = (i: number) => (data.length > 1 ? i * step : plotW / 2);
  const y = (v: number) => plotH - (v / domainMax) * plotH;

  const labelEvery = Math.max(1, Math.ceil(data.length / maxLabels));
  const empty = data.length === 0;

  return (
    <ChartFrame
      title={title}
      caption={caption}
      aside={aside}
      series={series}
      empty={empty}
      tableColumns={["Date", ...series.map((s) => s.label)]}
      tableRows={data.map((d) => [
        d.label,
        ...d.values.map((v) => (v == null ? "—" : formatValue(v))),
      ])}
    >
      <div ref={wrapRef} className="relative w-full">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}. ${data.length} points over time.`}
          onMouseLeave={() => {
            setTip(null);
            setHoverIndex(null);
          }}
          onMouseMove={(e) => {
            const box = wrapRef.current?.getBoundingClientRect();
            if (!box || data.length === 0) return;
            const px = e.clientX - box.left - PAD.left;
            const i = Math.max(0, Math.min(data.length - 1, Math.round(px / (step || 1))));
            const d = data[i]!;
            setHoverIndex(i);
            setTip({
              x: e.clientX - box.left,
              y: e.clientY - box.top,
              title: d.label,
              rows: series.map((s, si) => ({
                label: s.label,
                value:
                  d.values[si] == null
                    ? "—"
                    : `${formatValue(d.values[si]!)}${unit ? ` ${unit}` : ""}`,
                color: s.color,
              })),
            });
          }}
        >
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--cbva-grid)" />
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

            {reference ? (
              <>
                <line
                  x1={0}
                  x2={plotW}
                  y1={y(reference.value)}
                  y2={y(reference.value)}
                  stroke="var(--cbva-ink-subtle)"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                />
                <text
                  x={plotW - 2}
                  y={y(reference.value) - 5}
                  textAnchor="end"
                  className="fill-ink-subtle text-[10px]"
                >
                  {reference.label}
                </text>
              </>
            ) : null}

            {hoverIndex != null ? (
              <line
                x1={x(hoverIndex)}
                x2={x(hoverIndex)}
                y1={0}
                y2={plotH}
                stroke="var(--cbva-ink-subtle)"
                strokeWidth={1}
              />
            ) : null}

            {series.map((s, si) => {
              const path = data
                .map((d, i) => {
                  const v = d.values[si];
                  if (v == null) return null;
                  return `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`;
                })
                .filter(Boolean)
                .join(" ");
              return (
                <path
                  key={s.key}
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}

            {/* Markers only on the hovered point: a dot on every point of a
                56-day line is noise, and the crosshair already says where you
                are. The 2px paper ring keeps it legible over a line. */}
            {hoverIndex != null
              ? series.map((s, si) => {
                  const v = data[hoverIndex]?.values[si];
                  if (v == null) return null;
                  return (
                    <circle
                      key={s.key}
                      cx={x(hoverIndex)}
                      cy={y(v)}
                      r={4}
                      fill={s.color}
                      stroke="var(--cbva-paper)"
                      strokeWidth={2}
                    />
                  );
                })
              : null}

            <line
              x1={0}
              x2={plotW}
              y1={plotH}
              y2={plotH}
              stroke="var(--cbva-hairline)"
            />

            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={d.key}
                  x={x(i)}
                  y={plotH + 15}
                  textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                  className="fill-ink-subtle text-[10px]"
                >
                  {d.label}
                </text>
              ) : null,
            )}
          </g>
        </svg>
        <ChartTooltip state={tip} width={width} />
      </div>
    </ChartFrame>
  );
}
