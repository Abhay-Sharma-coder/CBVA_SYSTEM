"use client";

import { useReducedMotion } from "motion/react";

import { ListView } from "@/components/floor-plan/list-view";
import { PlanCanvas } from "@/components/floor-plan/plan-canvas";
import { ThreeView } from "@/components/floor-plan/three-view";
import type {
  FloorPlanMode,
  FloorPlanSeat,
  FloorPlanView,
} from "@/components/floor-plan/types";
import type { ZoneCode } from "@/lib/floorplan";

export interface FloorPlanProps {
  seats: FloorPlanSeat[];
  /**
   * "3d" renders this same seat array through the same store. Seat position is
   * data; 2D versus 3D is a rendering choice, so nothing above this component
   * may know which one is showing.
   */
  mode: FloorPlanMode;
  view?: FloorPlanView;
  activeZone?: ZoneCode | null;
  focusedSeatCode?: string | null;
  /** The seat whose dialog is open. Shared with 2D; drawn as the gold ring. */
  selectedSeatCode?: string | null;
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
  selectedSeatCode = null,
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
    // The SAME seat array, the SAME store, the same activate callback that
    // opens the same dialog. 2D and 3D differ only in how a seat is drawn.
    //
    // `onDragSeat` is deliberately not forwarded: moving a desk is a plan-space
    // edit the admin editor performs against the drawing, and doing it by
    // dragging a box across a perspective projection would be a worse tool, not
    // a better one. The editor stays 2D.
    return (
      <ThreeView
        seats={seats}
        activeZone={activeZone}
        focusedSeatCode={focusedSeatCode}
        selectedSeatCode={selectedSeatCode}
        reduceMotion={reduceMotion}
        crossfadeKey={crossfadeKey}
        onFocusSeat={onFocusSeat ?? noop}
        onActivateSeat={onActivateSeat ?? noop}
        className={className}
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
