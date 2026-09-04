"use client";

import { Component, useCallback, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

import { PlanCanvas } from "@/components/floor-plan/plan-canvas";
import type { FloorPlanSeat } from "@/components/floor-plan/types";
import {
  FALLBACK_NOTICE,
  detectWebgl,
  type FallbackReason,
} from "@/components/floor-plan/three/webgl";
import type { ZoneCode } from "@/lib/floorplan";

/**
 * THE 3D VIEW'S FRONT DOOR — and the only place `three` is reachable from.
 *
 * Two jobs, both about what happens when things are not ideal.
 *
 * 1. LAZY. `next/dynamic` with `ssr: false` puts three.js, drei and this entire
 *    scene in a chunk of their own. Most people who open /floor never press the
 *    3D toggle, and they must not pay 500 KB for a feature they did not use.
 *    Nothing above this file may import from `three/` — that is what keeps the
 *    promise, and it is easy to break by accident with a stray type import.
 *
 * 2. FALLBACK. Three things can go wrong: no WebGL at all, a context lost mid
 *    session, or a throw inside the scene. All three land here and degrade to
 *    the 2D plan with one quiet line of explanation. A blank black rectangle in
 *    front of a partner is worse than never having offered 3D.
 */
const Scene3D = dynamic(() => import("@/components/floor-plan/three/scene"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full" role="status" aria-label="Loading the 3D floor plan" />
  ),
});

export interface ThreeViewProps {
  seats: FloorPlanSeat[];
  activeZone: ZoneCode | null;
  focusedSeatCode: string | null;
  selectedSeatCode: string | null;
  reduceMotion: boolean;
  crossfadeKey: string;
  onFocusSeat: (code: string | null) => void;
  onActivateSeat: (seat: FloorPlanSeat) => void;
  className?: string;
}

export function ThreeView(props: ThreeViewProps) {
  const {
    seats,
    activeZone,
    focusedSeatCode,
    selectedSeatCode,
    reduceMotion,
    crossfadeKey,
    onFocusSeat,
    onActivateSeat,
    className,
  } = props;

  // Probed in an effect, not during render: the server has no WebGL and would
  // otherwise render the fallback into the HTML, which then flickers away.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [fallback, setFallback] = useState<FallbackReason | null>(null);

  useEffect(() => {
    setSupported(detectWebgl() === "supported");
  }, []);

  const onContextLost = useCallback(() => setFallback("lost"), []);
  const onFailure = useCallback(() => setFallback("failed"), []);

  const reason: FallbackReason | null =
    fallback ?? (supported === false ? "unsupported" : null);

  if (reason) {
    return (
      <FallbackPlan
        reason={reason}
        seats={seats}
        activeZone={activeZone}
        focusedSeatCode={focusedSeatCode}
        reduceMotion={reduceMotion}
        crossfadeKey={crossfadeKey}
        onFocusSeat={onFocusSeat}
        onActivateSeat={onActivateSeat}
        className={className}
      />
    );
  }

  if (supported === null) {
    return <div className={className} role="status" aria-label="Preparing the 3D floor plan" />;
  }

  return (
    <SceneBoundary onFailure={onFailure}>
      <div className={`relative ${className ?? ""}`}>
        {/*
          The canvas is not the accessible path and does not pretend to be. It
          is labelled as a picture with a summary, and the label points at the
          two renderings that ARE keyboard operable. The mode toggle sits next
          to the plan/list toggle, so getting back out is never more than one
          control away.

          `data-focused-seat` and `data-selected-seat` are what the 2D plan
          publishes as `[data-seat]`, in the one form a canvas can. There is no
          DOM node per desk here, so without them nothing outside the scene —
          the e2e suite included — can tell which desk the pointer is over, and
          the only way to find one is to click blindly around the canvas.
        */}
        <div
          className="h-full w-full"
          role="img"
          data-focused-seat={focusedSeatCode ?? ""}
          data-selected-seat={selectedSeatCode ?? ""}
          aria-label={`Three-dimensional view of Floor 4, showing ${seats.length} desks. For keyboard access use the plan or list view.`}
        >
          <Scene3D
            seats={seats}
            activeZone={activeZone}
            focusedSeatCode={focusedSeatCode}
            selectedSeatCode={selectedSeatCode}
            reduceMotion={reduceMotion}
            onFocusSeat={onFocusSeat}
            onActivateSeat={onActivateSeat}
            onContextLost={onContextLost}
            onFailure={onFailure}
            className="h-full w-full"
          />
        </div>
      </div>
    </SceneBoundary>
  );
}

function FallbackPlan({
  reason,
  className,
  ...rest
}: {
  reason: FallbackReason;
  seats: FloorPlanSeat[];
  activeZone: ZoneCode | null;
  focusedSeatCode: string | null;
  reduceMotion: boolean;
  crossfadeKey: string;
  onFocusSeat: (code: string | null) => void;
  onActivateSeat: (seat: FloorPlanSeat) => void;
  className?: string;
}) {
  return (
    <div className="space-y-2">
      <p
        className="text-xs text-ink-subtle"
        role="status"
        data-floor-3d="fallback"
        data-fallback-reason={reason}
      >
        {FALLBACK_NOTICE[reason]}
      </p>
      <PlanCanvas {...rest} className={className} />
    </div>
  );
}

/**
 * A local boundary, because this app has no `error.tsx` anywhere and does not
 * want one: a route-level error page would replace the whole floor screen, when
 * all that has actually failed is one optional rendering of it.
 */
class SceneBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
