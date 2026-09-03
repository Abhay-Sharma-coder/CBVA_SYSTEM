"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { FULL_FLOOR_BOUNDS, PLAN_BOUNDS } from "@/lib/floorplan";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

/** Bounds on *manual* zoom. Fitting is allowed below MIN_SCALE — see fitTo. */
export const MIN_SCALE = 0.35;
export const MAX_SCALE = 6;
/** Absolute floor, so "fit to floor" always genuinely fits. */
const FIT_MIN_SCALE = 0.12;

/**
 * Pan and zoom over the plan.
 *
 * The whole layer moves as one CSS transform. Nothing is re-laid-out on pan or
 * zoom and no per-seat work happens, which is what keeps 141 interactive nodes
 * at 60fps on a mid-range laptop. `fitTo` returns the transform that frames a
 * plan-space rectangle; the caller animates towards it.
 */
export function usePanZoom(initial?: Rect) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; tx: number; ty: number } | null>(
    null,
  );
  const framed = useRef(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ width: box.width, height: box.height });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitTo = useCallback(
    (rect: Rect, padding = 16): Transform => {
      if (size.width === 0 || size.height === 0) return { scale: 1, x: 0, y: 0 };
      const w = Math.max(1, size.width - padding * 2);
      const h = Math.max(1, size.height - padding * 2);
      // Fitting deliberately ignores MIN_SCALE. On a 390px phone the whole
      // cruciform needs about 0.3, and clamping that up to the manual-zoom
      // floor cropped both side wings off the screen.
      const scale = Math.min(w / rect.width, h / rect.height);
      const clamped = Math.min(MAX_SCALE, Math.max(FIT_MIN_SCALE, scale));
      // Layer coordinates are plan coordinates with PLAN_BOUNDS' origin at 0,0.
      const cx = rect.x + rect.width / 2 - PLAN_BOUNDS.x;
      const cy = rect.y + rect.height / 2 - PLAN_BOUNDS.y;
      return {
        scale: clamped,
        x: size.width / 2 - cx * clamped,
        y: size.height / 2 - cy * clamped,
      };
    },
    [size.width, size.height],
  );

  // Frame the floor once, as soon as the container has been measured.
  useEffect(() => {
    if (framed.current || size.width === 0) return;
    framed.current = true;
    setTransform(fitTo(initial ?? FULL_FLOOR_BOUNDS));
  }, [fitTo, initial, size.width]);

  const zoomAt = useCallback((factor: number, originX?: number, originY?: number) => {
    setTransform((t) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
      const el = containerRef.current;
      const ox = originX ?? (el ? el.clientWidth / 2 : 0);
      const oy = originY ?? (el ? el.clientHeight / 2 : 0);
      const k = next / t.scale;
      return { scale: next, x: ox - (ox - t.x) * k, y: oy - (oy - t.y) * k };
    });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only bare plan starts a pan. Capturing the pointer on the container
    // stops a `click` ever reaching anything inside it, so seats and the
    // overlaid zoom controls have to be excluded here or they go dead.
    if ((e.target as HTMLElement).closest("[data-seat], button, a, input, select, textarea")) {
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    setTransform((t) => {
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
      return t;
    });
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setTransform((t) => ({
      ...t,
      x: d.tx + (e.clientX - d.x),
      y: d.ty + (e.clientY - d.y),
    }));
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    containerRef.current?.releasePointerCapture?.(e.pointerId);
  }, []);

  // Non-passive so ctrl+wheel pinch-zoom does not zoom the whole page instead.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 2) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  return {
    containerRef,
    size,
    transform,
    setTransform,
    fitTo,
    zoomAt,
    isDragging: drag.current !== null,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
