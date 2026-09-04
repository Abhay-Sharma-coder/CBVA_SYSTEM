"use client";

import { Button } from "@/components/ui/button";
import type { ZoneCode } from "@/lib/floorplan";

/**
 * The camera affordances that have nowhere else to live.
 *
 * Deliberately only two. Flying to a wing is already the ZONE FILTER's job —
 * that value is shared with the 2D plan and the legend counts, so adding a
 * second set of zone buttons here would put the same state in two controls and
 * guarantee they disagree. Choose Zone C on the plan, switch to 3D, and you are
 * looking at Zone C, because it is the same zone.
 *
 * "Top down" is the moment worth building a button for: it eases to a plan-like
 * camera, and the drawing on the floor resolves into exactly the sheet the
 * client handed us. That is the demonstration that the 3D view and the 2D plan
 * are the same building, and it should take one tap.
 */
export function SceneControls({
  activeZone,
  view,
  onTopDown,
  onWholeFloor,
}: {
  activeZone: ZoneCode | null;
  view: "free" | "topDown";
  onTopDown: () => void;
  onWholeFloor: () => void;
}) {
  return (
    // The demo panel is pinned to the bottom-right of the viewport, and on a
    // phone it lands squarely on top of these two buttons. Sitting above it
    // below `sm` costs nothing on a desktop, where the two are nowhere near
    // each other.
    <div className="pointer-events-none absolute right-3 bottom-14 flex gap-2 sm:bottom-3">
      <Button
        size="sm"
        variant="secondary"
        className="pointer-events-auto"
        aria-pressed={view === "topDown"}
        onClick={view === "topDown" ? onWholeFloor : onTopDown}
      >
        {view === "topDown" ? "Angled view" : "Top down"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="pointer-events-auto bg-surface/80"
        onClick={onWholeFloor}
      >
        {activeZone ? `Refit zone ${activeZone}` : "Refit floor"}
      </Button>
    </div>
  );
}
