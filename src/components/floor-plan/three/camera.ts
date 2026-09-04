import { useCallback, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { planLength, planToWorld } from "@/components/floor-plan/three/coords";

const WORLD_UP = new Vector3(0, 1, 0);

export const FOV = 42;

/**
 * A plan-space rectangle, as `boundsOf` / `zoneBounds` in `@/lib/floorplan`
 * return one. Declared structurally rather than imported from `use-pan-zoom`,
 * which is 2D-only and has no business in the lazily-loaded 3D chunk.
 */
export interface PlanRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Polar angle is measured from straight down the +Y axis, so a SMALL polar is a
 * steep, near-plan view and a LARGE one is closer to eye level.
 *
 * The default is 0.646 rad — 37 degrees off vertical, a 53 degree tilt — which
 * is where the cruciform reads as four wings rather than as a smear. The clamps
 * exist because both extremes are useless: past 1.35 rad you are under the
 * furniture looking at the underside of desks, and flat-on you have lost the
 * third dimension you came for. The only route to a true plan view is the
 * top-down preset, which is a deliberate act rather than something you fall
 * into while dragging.
 */
export const POLAR = {
  default: 0.646,
  min: 0.35,
  max: 1.35,
  topDown: 0.02,
} as const;

export const AZIMUTH_DEFAULT = 0;

export interface Framing {
  position: Vector3;
  target: Vector3;
}

/**
 * Put a plan-space rectangle on screen. Solves the fit in both axes — a wing is
 * far wider than it is deep, and fitting only the width walks the far end off
 * the top of a portrait viewport.
 */
export function frameRect(
  rect: PlanRect,
  aspect: number,
  polar: number = POLAR.default,
  azimuth: number = AZIMUTH_DEFAULT,
  padding = 1.08,
): Framing {
  const [cx, , cz] = planToWorld(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const width = planLength(rect.width);
  const depth = planLength(rect.height);

  const vFov = MathUtils.degToRad(FOV);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.2));

  // Solve the fit against the four CORNERS, in the camera's own frame.
  //
  // Two simpler things were tried and both were wrong. Fitting each axis
  // independently is exact only looking straight down — at a 53 degree tilt the
  // near edge swings toward the lens and the far edge away, and the plan walked
  // off the bottom of the viewport. A bounding sphere fixes that but treats a
  // 90 x 68 metre slab as if it were 112 metres tall, so it pulls the camera
  // back until the building is a stamp in the middle of an empty frame.
  //
  // The exact condition is per corner: with the camera at distance `t` along
  // `d`, that corner sits at depth `t - c·d`, and it is inside the frustum when
  // its lateral offset is within tan(fov/2) of that depth. Rearranged, each
  // corner names a minimum `t`, and the fit is the largest of them.
  const d = new Vector3(
    Math.sin(polar) * Math.sin(azimuth),
    Math.cos(polar),
    Math.sin(polar) * Math.cos(azimuth),
  );
  const right = new Vector3().crossVectors(d, WORLD_UP).normalize();
  // Degenerate looking straight down, where any horizontal axis will do.
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  const up = new Vector3().crossVectors(right, d).normalize();

  const hx = width / 2;
  const hz = depth / 2;
  const corner = new Vector3();
  let distance = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      corner.set(sx * hx, 0, sz * hz);
      const along = corner.dot(d);
      distance = Math.max(
        distance,
        Math.abs(corner.dot(right)) / Math.tan(hFov / 2) + along,
        Math.abs(corner.dot(up)) / Math.tan(vFov / 2) + along,
      );
    }
  }
  distance *= padding;

  const target = new Vector3(cx, 0, cz);
  const position = new Vector3().copy(d).multiplyScalar(distance).add(target);
  return { position, target };
}

/** Frame one desk: close enough to read the seat, far enough to keep context. */
export function frameSeat(planX: number, planY: number, azimuth: number = AZIMUTH_DEFAULT): Framing {
  const [x, , z] = planToWorld(planX, planY);
  const distance = 9;
  const polar = 0.75;
  const target = new Vector3(x, 0.7, z);
  const position = new Vector3(
    x + distance * Math.sin(polar) * Math.sin(azimuth),
    distance * Math.cos(polar),
    z + distance * Math.sin(polar) * Math.cos(azimuth),
  );
  return { position, target };
}

interface Flight {
  position: Vector3;
  target: Vector3;
  /** Seconds. Zero snaps, which is what reduced motion asks for. */
  duration: number;
  elapsed: number;
  fromPosition: Vector3;
  fromTarget: Vector3;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * Camera flights, driven from `useFrame` rather than `motion/react`.
 *
 * ADR-011 makes `motion` the animation library, and it stays that for the DOM;
 * it has no way to drive a three.js camera and an OrbitControls target in step
 * with the render loop, and animating them out of step produces the drift that
 * makes a fly-to feel broken. The easing curve here is the same shape the rest
 * of the product uses.
 */
export function useCameraFlight(
  controls: React.RefObject<OrbitControlsImpl | null>,
  reduceMotion: boolean,
) {
  const flight = useRef<Flight | null>(null);
  const { camera } = useThree();

  const flyTo = useCallback(
    (to: Framing, seconds = 0.75) => {
      const duration = reduceMotion ? 0 : seconds;
      const target = controls.current?.target ?? new Vector3();
      flight.current = {
        position: to.position.clone(),
        target: to.target.clone(),
        duration,
        elapsed: 0,
        fromPosition: camera.position.clone(),
        fromTarget: target.clone(),
      };
    },
    [camera, controls, reduceMotion],
  );

  useFrame((_, delta) => {
    const f = flight.current;
    if (!f) return;
    const c = controls.current;

    f.elapsed += delta;
    const t = f.duration <= 0 ? 1 : Math.min(1, f.elapsed / f.duration);
    const k = easeInOut(t);

    camera.position.lerpVectors(f.fromPosition, f.position, k);
    if (c) {
      c.target.lerpVectors(f.fromTarget, f.target, k);
      c.update();
    }
    if (t >= 1) flight.current = null;
  });

  /** True while a flight owns the camera, so damping does not fight it. */
  const isFlying = useCallback(() => flight.current !== null, []);

  return { flyTo, isFlying };
}

export function cancelIfPerspective(camera: unknown): camera is PerspectiveCamera {
  return camera instanceof PerspectiveCamera;
}
