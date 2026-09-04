import { floorplanMeta, PLAN_BOUNDS } from "@/lib/floorplan";

/**
 * THE ONE CONVERSION between the architect's drawing and the 3D scene.
 *
 * Nothing else in `three/` may multiply a plan coordinate. Everything the
 * drawing knows — seats, walls, zones, the texture — arrives in plan units, and
 * every one of them comes through here, so there is a single place to be wrong
 * and a single place to fix it.
 *
 * Plan space is PDF points off the source sheet: origin top-left, +Y DOWN, one
 * unit = `meta.mmPerUnit` millimetres. World space is metres, +Y UP, with the
 * cruciform's core centred on the origin so the camera has something sane to
 * orbit around.
 *
 *   world.x = (plan.x - coreCentre.x) * metresPerUnit
 *   world.z = (plan.y - coreCentre.y) * metresPerUnit
 *
 * Mapping plan +Y onto world +Z (rather than negating it) is what lets the
 * top-down camera reproduce the drawing exactly. Orbit from azimuth 0 — the
 * camera on the +Z side — and looking almost straight down puts plan +X to
 * screen-right and plan +Y to screen-down, which is the drawing's own
 * orientation, with the default up vector and no special casing. That is the
 * whole point of the top-down preset: it has to BE the drawing.
 */

/**
 * 1:200 is the plot scale the drawing was measured against; if a future
 * revision fits no standard scale the build publishes `mmPerUnit: null` rather
 * than a number somebody might build on, and this is the stated fallback.
 */
const NOMINAL_MM_PER_UNIT = 70.5556;

export const METRES_PER_UNIT = (floorplanMeta.mmPerUnit ?? NOMINAL_MM_PER_UNIT) / 1000;

/** True when the drawing carried no resolvable scale and we are guessing. */
export const SCALE_IS_ASSUMED = floorplanMeta.mmPerUnit === null;

const [CORE_X, CORE_Y] = floorplanMeta.coreCentre;

/** A distance in plan units, in metres. */
export function planLength(units: number): number {
  return units * METRES_PER_UNIT;
}

/** A plan point on the floor plane. */
export function planToWorld(planX: number, planY: number): [number, number, number] {
  return [(planX - CORE_X) * METRES_PER_UNIT, 0, (planY - CORE_Y) * METRES_PER_UNIT];
}

/** The inverse, for turning a raycast hit back into something the 2D view knows. */
export function worldToPlan(x: number, z: number): [number, number] {
  return [x / METRES_PER_UNIT + CORE_X, z / METRES_PER_UNIT + CORE_Y];
}

/**
 * Plan rotation is degrees clockwise in a Y-down frame. Rotating about world +Y
 * is counter-clockwise seen from above in a Z-down-the-screen frame, so the two
 * conventions differ by a sign and nothing else. Verified against the baked
 * texture rather than reasoned about — chairs tuck into desks or they do not.
 */
export function planRotationToY(deg: number): number {
  return (-deg * Math.PI) / 180;
}

/** The floor plane, in metres. 90.66 m x 68.44 m at 70.5556 mm per unit. */
export const FLOOR_SIZE = {
  width: planLength(PLAN_BOUNDS.width),
  depth: planLength(PLAN_BOUNDS.height),
} as const;

/**
 * The floor plane's own centre in world space. PLAN_BOUNDS is the sheet's plan
 * box; `coreCentre` is the middle of the building, and the two are not the same
 * point, so the plane needs an offset or the drawing lands off-register.
 */
export const FLOOR_CENTRE = planToWorld(
  PLAN_BOUNDS.x + PLAN_BOUNDS.width / 2,
  PLAN_BOUNDS.y + PLAN_BOUNDS.height / 2,
);

/** Real dimensions, in metres. Invented — see ASSUMPTIONS A23. */
export const DIMENSIONS = {
  wallHeight: 2.7,
  // CAD draws both faces of a wall, so a chain per face already gives a wall
  // its real thickness; extruding each at a nominal 150mm stacked them into
  // something twice the width of the line underneath. These are the extrusion
  // widths of a single face, not the thickness of the wall.
  wallThickness: 0.07,
  partitionHeight: 1.35,
  partitionThickness: 0.055,
  glazingHeight: 2.7,
  glazingThickness: 0.04,
  // 1.30 rather than a nominal 1.5: the tightest pair of DETECTED desk anchors
  // in the drawing is 1.36 m apart, and a 1.5 m desk would visibly intersect
  // its neighbour there. The measured workstation pitch is 1.62 m, so this is
  // a realistic desk with a realistic gap either side.
  deskWidth: 1.3,
  deskDepth: 0.75,
  deskHeight: 0.74,
  deskTopThickness: 0.04,
  chairSeatHeight: 0.45,
  chairWidth: 0.5,
} as const;
