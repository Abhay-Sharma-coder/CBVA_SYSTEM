"use client";

import { useReducedMotion } from "motion/react";

import { ListView } from "@/components/floor-plan/list-view";
import { PlanCanvas } from "@/components/floor-plan/plan-canvas";
import type {
  FloorPlanMode,
  FloorPlanSeat,
  FloorPlanView,
} from "@/components/floor-plan/types";
import type { ZoneCode } from "@/lib/floorplan";

export interface FloorPlanProps {
  seats: FloorPlanSeat[];
  /**
   * Phase 4 adds "3d" over this same seat array and the same store. Seat
   * position is data; 2D versus 3D is a rendering choice, so nothing above
   * this component may know which one is showing.
   */
  mode: FloorPlanMode;
  view?: FloorPlanView;
  activeZone?: ZoneCode | null;
  focusedSeatCode?: string | null;
  crossfadeKey?: string;
  onFocusSeat?: (code: string | null) => void;
  onActivateSeat?: (seat: FloorPlanSeat) => void;
  /** Supplied only by the admin editor; absent means seats cannot be moved. */
  onDragSeat?: (seatCode: string, planX: number, planY: number) => void;
  className?: string;
}

export function FloorPlan({
  seats,
  mode,
  view = "plan",
  activeZone = null,
  focusedSeatCode = null,
  crossfadeKey = "",
  onFocusSeat,
  onActivateSeat,
  onDragSeat,
  className,
}: FloorPlanProps) {
  // Read once, here, and thread it down. Every animation in the subtree is
  // gated on this value rather than relying on the global CSS override, so
  // spring animations driven by JS are genuinely off and not just fast.
  const reduceMotion = useReducedMotion() ?? false;

  const noop = () => {};

  if (view === "list") {
    return <ListView seats={seats} onActivateSeat={onActivateSeat ?? noop} />;
  }

  if (mode === "3d") {
    // Phase 4. Deliberately not a stub component with its own seat handling —
    // when it lands it renders this same array through the same store.
    return (
      <div
        className={className}
        role="note"
        aria-label="The 3D view arrives in Phase 4"
      />
    );
  }

  return (
    <PlanCanvas
      seats={seats}
      activeZone={activeZone}
      focusedSeatCode={focusedSeatCode}
      reduceMotion={reduceMotion}
      crossfadeKey={crossfadeKey}
      onFocusSeat={onFocusSeat ?? noop}
      onActivateSeat={onActivateSeat ?? noop}
      onDragSeat={onDragSeat}
      className={className}
    />
  );
}
