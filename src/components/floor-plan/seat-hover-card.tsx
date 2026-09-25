"use client";

import { motion } from "motion/react";

import { SEAT_STATUS_TOKENS } from "@/components/seat/seat-status";
import type { FloorPlanSeat } from "@/components/floor-plan/types";

interface SeatHoverCardProps {
  seat: FloorPlanSeat;
  screenX: number;
  screenY: number;
  containerWidth: number;
  reduceMotion: boolean;
}

const SEAT_TYPE_LABEL: Record<FloorPlanSeat["seatType"], string> = {
  workstation: "Workstation",
  passage: "Passage desk",
  foldable: "Foldable desk",
  cabin: "Cabin",
};

/**
 * The hover and focus card. Deliberately not a tooltip primitive: it is
 * positioned in the plan's own screen space and must not steal focus, since it
 * appears while the user is arrowing between seats.
 */
export function SeatHoverCard({
  seat,
  screenX,
  screenY,
  containerWidth,
  reduceMotion,
}: SeatHoverCardProps) {
  const token = SEAT_STATUS_TOKENS[seat.status];
  const flip = screenX > containerWidth - 190;

  return (
    <motion.div
      // aria-hidden on purpose. The seat button's own accessible name already
      // carries code, zone, bay, status and occupant, and it fires on focus.
      // Announcing this card as well would say everything twice while a
      // keyboard user arrows across a bay.
      aria-hidden="true"
      data-seat-card={seat.seatCode}
      className="pointer-events-none absolute z-30 w-44 rounded-md border border-hairline bg-surface px-3 py-2 shadow-hairline"
      style={{
        left: flip ? screenX - 190 : screenX + 16,
        top: Math.max(4, screenY - 28),
      }}
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.12 }}
    >
      <p className="seat-code text-xs font-medium text-ink">{seat.seatCode}</p>
      <p className="mt-0.5 text-[11px] text-ink-muted">
        Zone {seat.zone} · Bay {seat.bay} · {SEAT_TYPE_LABEL[seat.seatType]}
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink">
        {token.glyph ? (
          <span aria-hidden="true" className="text-ink-muted">
            {token.glyph}
          </span>
        ) : null}
        {token.label}
      </p>
      {seat.occupantName ? (
        <p className="mt-0.5 truncate text-[11px] text-ink-muted">{seat.occupantName}</p>
      ) : null}
    </motion.div>
  );
}
