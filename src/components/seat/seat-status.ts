import type { ComponentType } from "react";

/**
 * THE SEAT STATUS VOCABULARY — single source of truth.
 *
 * Phase 2's interactive floor plan, Phase 4's 3D view and Phase 5's analytics
 * all render from this table. If a status ever needs a new colour or glyph, it
 * changes here and nowhere else.
 *
 * Every status carries a NON-COLOUR differentiator (border treatment + glyph),
 * because roughly 1 in 12 men has a colour vision deficiency and partners print
 * these screens in greyscale. Colour is the secondary cue throughout.
 */
export const SEAT_STATUSES = [
  "available",
  "booked",
  "your_booking",
  "reserved_fixed",
  "checked_in",
  "auto_released",
  "blocked",
] as const;

export type SeatVisualStatus = (typeof SEAT_STATUSES)[number];

export interface SeatStatusToken {
  /** Short label for legends and tooltips. */
  label: string;
  /** What it means, in the words a user would use. */
  description: string;
  /** Tailwind classes for the swatch body. */
  className: string;
  /** Non-colour differentiator, drawn inside the swatch. */
  glyph: string | null;
  /** Screen-reader text; the glyph alone is not an accessible name. */
  srLabel: string;
  /** Whether a bookable-grade user can act on a seat in this state. */
  interactive: boolean;
}

export const SEAT_STATUS_TOKENS: Record<SeatVisualStatus, SeatStatusToken> = {
  available: {
    label: "Available",
    description: "Free to book for this slot.",
    className: "bg-paper border border-navy text-navy",
    glyph: null,
    srLabel: "Available",
    interactive: true,
  },
  booked: {
    label: "Booked",
    description: "Taken by a colleague for this slot.",
    className: "bg-navy-tint border border-navy text-navy",
    glyph: "·",
    srLabel: "Booked by a colleague",
    interactive: false,
  },
  your_booking: {
    label: "Your Booking",
    description: "You hold this seat. The gold rule marks it as yours.",
    // The one place gold is load-bearing: a 2px rule, on at most one seat.
    // The fill is `navy-yours`, not `navy-tint-strong` (Phase 8 / B1): at
    // 14% navy the chip measured 1.29:1 against the drawing as a graphical
    // object, under WCAG 1.4.11's 3:1. 95% clears it with margin (3.29:1) —
    // dark enough that the glyph and code need paper text now, not navy.
    className: "bg-navy-yours border-2 border-gold text-paper",
    glyph: "●",
    srLabel: "Your booking",
    interactive: true,
  },
  reserved_fixed: {
    label: "Reserved (Fixed)",
    description: "Allocated to a Manager or above. Never bookable.",
    className: "bg-surface-sunken border border-dashed border-ink-subtle text-ink-muted",
    glyph: "▪",
    srLabel: "Reserved, fixed allocation",
    interactive: false,
  },
  checked_in: {
    label: "Checked In",
    description: "Occupant has badged in. Counts as real occupancy.",
    className: "bg-navy border border-navy text-paper",
    glyph: "✓",
    srLabel: "Checked in",
    interactive: false,
  },
  auto_released: {
    label: "Auto Released",
    description:
      "Nobody checked in within the grace window, so the seat went back into the pool.",
    className: "bg-paper border border-dotted border-caution text-caution",
    glyph: "↺",
    srLabel: "Auto released, back in the pool",
    interactive: true,
  },
  blocked: {
    label: "Blocked",
    description: "Out of service — maintenance, works, or a decommissioned desk.",
    className: "hatch bg-surface-sunken border border-ink text-ink",
    glyph: "✕",
    srLabel: "Blocked, out of service",
    interactive: false,
  },
};

export type SeatGlyphComponent = ComponentType<{ className?: string }>;
