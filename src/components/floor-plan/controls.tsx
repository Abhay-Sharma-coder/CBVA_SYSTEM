"use client";

import { motion } from "motion/react";
import { Box, List, Map as MapIcon, Maximize2, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { SEAT_STATUSES, SEAT_STATUS_TOKENS } from "@/components/seat/seat-status";
import type {
  BookableDay,
  FloorPlanMode,
  FloorPlanView,
  SlotDefinition,
  SlotKey,
} from "@/components/floor-plan/types";
import { floorplanZones, type ZoneCode } from "@/lib/floorplan";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------- dates */

export function DateStrip({
  days,
  active,
  onChange,
}: {
  days: BookableDay[];
  active: string | null;
  onChange: (date: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Booking date"
      className="flex gap-1 overflow-x-auto pb-1"
    >
      {days.map((day) => {
        const selected = day.date === active;
        return (
          <button
            key={day.date}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(day.date)}
            className={cn(
              "relative min-w-16 shrink-0 rounded-sm border px-3 py-2 text-center transition-colors",
              selected
                ? "border-navy bg-navy-tint text-ink"
                : "border-hairline bg-surface text-ink-muted hover:bg-surface-sunken",
            )}
          >
            <span className="block text-[10px] tracking-wide uppercase">
              {day.isToday ? "Today" : day.weekdayLabel}
            </span>
            <span className="tabular block text-sm font-medium">{day.dayLabel}</span>
            {/* ink-muted, not ink-subtle: the selected chip sits on navy-tint
                rather than paper, where subtle drops to 4.21:1. */}
            <span className="block text-[10px] text-ink-muted">{day.monthLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- slots */

export function SlotToggle({
  slots,
  active,
  onChange,
}: {
  slots: SlotDefinition[];
  active: SlotKey;
  onChange: (slot: SlotKey) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Slot"
      className="flex items-center gap-6 border-b border-hairline"
    >
      {slots.map((slot) => {
        const selected = slot.key === active;
        return (
          <button
            key={slot.key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(slot.key)}
            className={cn(
              "-mb-px border-b-2 pb-2 text-sm transition-colors",
              // The sanctioned gold: an active underline, nothing filled.
              selected
                ? "border-gold font-medium text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {slot.label}
            <span className="tabular ml-2 text-[11px] text-ink-subtle">
              {slot.start}–{slot.end}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ zone */

export function ZoneFilter({
  active,
  onChange,
}: {
  active: ZoneCode | null;
  onChange: (zone: ZoneCode | null) => void;
}) {
  const options: Array<{ value: ZoneCode | null; label: string }> = [
    { value: null, label: "Whole floor" },
    ...floorplanZones.zones.map((z) => ({ value: z.code, label: `Zone ${z.code}` })),
  ];
  return (
    <div role="radiogroup" aria-label="Zone" className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const selected = active === opt.value;
        return (
          <button
            key={opt.label}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-sm border px-2.5 py-1 text-xs transition-colors",
              selected
                ? "border-navy bg-navy text-paper"
                : "border-hairline bg-surface text-ink-muted hover:bg-surface-sunken",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ zoom */

export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button size="icon" variant="secondary" onClick={onZoomOut} aria-label="Zoom out">
        <Minus aria-hidden="true" />
      </Button>
      <Button size="icon" variant="secondary" onClick={onZoomIn} aria-label="Zoom in">
        <Plus aria-hidden="true" />
      </Button>
      <Button size="sm" variant="secondary" onClick={onFit}>
        <Maximize2 aria-hidden="true" />
        Fit to floor
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------- view mode */

export function ViewToggle({
  view,
  onChange,
}: {
  view: FloorPlanView;
  onChange: (v: FloorPlanView) => void;
}) {
  return (
    <div role="radiogroup" aria-label="View" className="flex items-center gap-1">
      {(
        [
          ["plan", "Plan", MapIcon],
          ["list", "List", List],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view === value}
          onClick={() => onChange(value)}
          className={cn(
            "flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs transition-colors",
            view === value
              ? "border-navy bg-navy text-paper"
              : "border-hairline bg-surface text-ink-muted hover:bg-surface-sunken",
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * 2D or 3D, sitting beside the plan/list toggle rather than hidden in the
 * canvas, because the way back out of 3D has to be as visible as the way in.
 *
 * It disappears in list view: "3D list" is not a thing, and offering a control
 * that silently does nothing is worse than not offering it.
 */
export function ModeToggle({
  mode,
  onChange,
}: {
  mode: FloorPlanMode;
  onChange: (m: FloorPlanMode) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Floor plan rendering" className="flex items-center gap-1">
      {(
        [
          ["2d", "Plan view", MapIcon],
          ["3d", "3D view", Box],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          data-mode={value}
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            "flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs transition-colors",
            mode === value
              ? "border-navy bg-navy text-paper"
              : "border-hairline bg-surface text-ink-muted hover:bg-surface-sunken",
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- occupancy */

/**
 * The one number this screen exists to produce, and therefore the one gold
 * accent on it. Everything else about booking is a means to this figure being
 * trustworthy.
 */
export function OccupancyCount({
  occupied,
  capacity,
  reduceMotion,
}: {
  occupied: number;
  capacity: number;
  reduceMotion: boolean;
}) {
  const pct = capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;
  return (
    <div className="flex items-baseline gap-2">
      <motion.span
        key={`${occupied}-${capacity}`}
        className="tabular font-title text-2xl text-ink"
        initial={reduceMotion ? false : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.18 }}
      >
        {occupied}
        <span className="text-ink-subtle">/{capacity}</span>
      </motion.span>
      <Badge variant="gold">{pct}% occupied</Badge>
    </div>
  );
}

/* ---------------------------------------------------------------- legend */

export function Legend({ counts }: { counts: Record<string, number> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-2">
      {SEAT_STATUSES.map((status) => {
        const token = SEAT_STATUS_TOKENS[status];
        const n = counts[status] ?? 0;
        if (n === 0) return null;
        return (
          <li key={status} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-4 items-center justify-center rounded-sm text-[8px] leading-none",
                token.className,
              )}
            >
              {token.glyph}
            </span>
            {token.label}
            <span className="tabular text-ink-subtle">{n}</span>
          </li>
        );
      })}
    </ul>
  );
}
