/**
 * Typed access to the generated floor plan geometry.
 *
 * `src/data/floorplan/` is written by `npm run build:floorplan` from the
 * architect's PDF and committed, so importing it is a compile-time constant on
 * both server and client — no fetch, no loading state, no runtime parse cost
 * for the wall and zone geometry.
 *
 * seats.json is the source of truth for seat position: the seed reads it, and
 * the editor at /admin/floor-plan writes back to it. The database mirrors it so
 * that a desk can be moved without a redeploy.
 */
import detectedModulesJson from "@/data/floorplan/detected-modules.json";
import detectionReportJson from "@/data/floorplan/detection-report.json";
import metaJson from "@/data/floorplan/meta.json";
import seatsJson from "@/data/floorplan/seats.json";
import wallsJson from "@/data/floorplan/walls.json";
import zonesJson from "@/data/floorplan/zones.json";
import {
  detectedModulesSchema,
  detectionReportSchema,
  floorplanMetaSchema,
  seatAnchorsSchema,
  wallsSchema,
  zonesSchema,
} from "@/lib/floorplan-schema";

export const floorplanMeta = floorplanMetaSchema.parse(metaJson);
export const floorplanWalls = wallsSchema.parse(wallsJson);
export const floorplanZones = zonesSchema.parse(zonesJson);
export const floorplanSeatAnchors = seatAnchorsSchema.parse(seatsJson);
export const floorplanDetectedModules = detectedModulesSchema.parse(detectedModulesJson);
export const floorplanDetectionReport = detectionReportSchema.parse(detectionReportJson);

export const PLAN_BOUNDS = floorplanMeta.planBounds;
export const PLAN_VIEWBOX = floorplanMeta.viewBox;

export type ZoneCode = (typeof floorplanZones.zones)[number]["code"];

const anchorsByCode = new Map(
  floorplanSeatAnchors.seats.map((s) => [s.seatCode, s] as const),
);

export function seatAnchor(seatCode: string) {
  return anchorsByCode.get(seatCode);
}

/** Zone outlines keyed by code, for highlighting and hit testing. */
export const zoneByCode = new Map(floorplanZones.zones.map((z) => [z.code, z] as const));

/**
 * Bounding box of a set of plan points, padded. Used to frame a zone or the
 * whole floor in the viewport.
 */
export function boundsOf(points: Array<readonly [number, number]>, pad = 0) {
  if (points.length === 0) {
    return { x: PLAN_BOUNDS.x, y: PLAN_BOUNDS.y, width: PLAN_BOUNDS.width, height: PLAN_BOUNDS.height };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

export const FULL_FLOOR_BOUNDS = boundsOf(
  floorplanZones.zones.flatMap((z) => z.polygon as Array<readonly [number, number]>),
  12,
);

export function zoneBounds(code: ZoneCode) {
  const zone = zoneByCode.get(code);
  if (!zone) return FULL_FLOOR_BOUNDS;
  return boundsOf(zone.polygon as Array<readonly [number, number]>, 16);
}

/**
 * Nearest detected chair block to a point, within `maxDistance` plan units.
 * This is what "snap to nearest detected workstation" in the editor uses, and
 * it searches every module the extraction found — including ones no seat was
 * assigned to, which is exactly where a bad detection needs rescuing.
 */
export function nearestDetectedModule(x: number, y: number, maxDistance = 40) {
  let best: { x: number; y: number; rotationDeg: number; distance: number } | null = null;
  for (const m of floorplanDetectedModules.modules) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d <= maxDistance && (best === null || d < best.distance)) {
      best = { x: m.x, y: m.y, rotationDeg: m.rotationDeg, distance: d };
    }
  }
  return best;
}
