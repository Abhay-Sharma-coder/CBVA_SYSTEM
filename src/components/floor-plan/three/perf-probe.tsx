"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * The performance budget, measured rather than asserted.
 *
 * Phase 4 was given numbers to hit — under 60 draw calls, 60fps on integrated
 * graphics — and a budget nobody measures is a wish. This publishes what the
 * renderer actually did on the last frame so the Playwright suite can read it
 * back and fail when it drifts.
 *
 * It is a handful of property reads per frame and no allocation, which is why
 * it can ship rather than hide behind a dev flag. The window property is the
 * only global this feature adds.
 */
export interface Cbva3dStats {
  fps: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  dpr: number;
  frames: number;
}

declare global {
  interface Window {
    __cbva3d?: Cbva3dStats;
  }
}

export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const window_ = typeof window === "undefined" ? null : window;
  const frames = useRef(0);
  const accumulated = useRef(0);
  const fps = useRef(0);

  useFrame((_, delta) => {
    if (!window_) return;
    frames.current += 1;
    accumulated.current += delta;

    // A rolling half-second window: long enough that one slow frame does not
    // dominate, short enough that a stutter is still visible in the number.
    if (accumulated.current >= 0.5) {
      fps.current = frames.current / accumulated.current;
      frames.current = 0;
      accumulated.current = 0;
    }

    const info = gl.info;
    window_.__cbva3d = {
      fps: Math.round(fps.current * 10) / 10,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      dpr: gl.getPixelRatio(),
      frames: info.render.frame,
    };
  });

  return null;
}
