/**
 * Whether this browser can show the 3D view at all.
 *
 * The rule is that there is never a blank canvas. Three things can go wrong —
 * no WebGL, a lost context, or a throw inside the scene — and all three land in
 * the same place: the 2D plan, with a quiet line saying why. A 3D view that
 * fails to a black rectangle in front of a client is worse than no 3D view.
 */
export type WebglSupport = "supported" | "unsupported" | "unknown";

export function detectWebgl(): WebglSupport {
  if (typeof document === "undefined") return "unknown";
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    if (!gl) return "unsupported";
    // Release it immediately; holding a probe context counts against the
    // browser's small per-page context budget, and the real canvas needs one.
    const lose = (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return "supported";
  } catch {
    return "unsupported";
  }
}

export const FALLBACK_NOTICE = {
  unsupported:
    "This browser cannot show the 3D view, so the plan is showing instead. Everything works the same way.",
  lost: "The 3D view lost its graphics context, so the plan is showing instead. Everything works the same way.",
  failed:
    "The 3D view could not be drawn, so the plan is showing instead. Everything works the same way.",
} as const;

export type FallbackReason = keyof typeof FALLBACK_NOTICE;
