/**
 * Shapes of the generated floor plan data in `src/data/floorplan/`.
 *
 * Kept apart from `floorplan.ts` so the build script can import the schemas
 * without dragging the JSON itself into the build's module graph — the build
 * is what writes that JSON, and on a first run it does not exist yet.
 */
import { z } from "zod";

const point = z.tuple([z.number(), z.number()]);

export const planBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const floorplanMetaSchema = z.object({
  generatorVersion: z.number().int(),
  source: z.string(),
  sourceSha256: z.string().length(64),
  planBounds: planBoundsSchema,
  viewBox: z.string(),
  coreCentre: point,
  /** Null when no standard plot scale fitted well enough to publish one. */
  mmPerUnit: z.number().positive().nullable(),
  scaleNote: z.string(),
  texture: z.object({ "2048": z.string(), "4096": z.string() }),
  counts: z.object({
    seats: z.number().int(),
    wallPolygons: z.number().int(),
    chairBlocksDetected: z.number().int(),
    chairBlocksUnassigned: z.number().int(),
    interiorCoverage: z.number(),
  }),
});

export const wallsSchema = z.object({
  viewBox: z.string(),
  polygons: z.array(z.object({ closed: z.boolean(), points: z.array(point).min(2) })),
});

export const zonesSchema = z.object({
  viewBox: z.string(),
  zones: z
    .array(
      z.object({
        code: z.enum(["A", "B", "C", "D"]),
        labelAnchor: point,
        polygon: z.array(point).min(3),
      }),
    )
    .min(1),
});

/**
 * How a seat's position was arrived at. `detected` means a chair block was
 * found in the drawing at that spot; `interpolated` means the bay came up
 * short and the position was extended along the run's own axis; `manual`
 * means somebody moved it in the editor at /admin/floor-plan.
 */
export const anchorSourceSchema = z.enum(["detected", "interpolated", "manual"]);
export type AnchorSource = z.infer<typeof anchorSourceSchema>;

export const seatAnchorSchema = z.object({
  seatCode: z.string(),
  bay: z.string(),
  zone: z.enum(["A", "B", "C", "D"]),
  planX: z.number(),
  planY: z.number(),
  rotationDeg: z.number().int().min(0).max(359),
  source: anchorSourceSchema,
});
export type SeatAnchor = z.infer<typeof seatAnchorSchema>;

export const seatAnchorsSchema = z.object({
  viewBox: z.string(),
  seats: z.array(seatAnchorSchema),
});

export const detectedModulesSchema = z.object({
  viewBox: z.string(),
  modules: z.array(
    z.object({ x: z.number(), y: z.number(), rotationDeg: z.number().int() }),
  ),
});

export const detectionReportSchema = z.object({
  generatedFrom: z.string(),
  sourceSha256: z.string(),
  scheduleDrift: z.record(
    z.string(),
    z.object({ drawingPax: z.number(), schedule: z.number() }),
  ),
  baysWithoutDrawingPax: z.array(z.string()),
  seatsConfirmedByDrawingPax: z.number().int(),
  zoneBChairsDetected: z.number().int(),
  zoneBExpected: z.number().int(),
  unassignedChairs: z.number().int(),
  bays: z.array(
    z.object({
      bay: z.string(),
      zone: z.string(),
      expected: z.number().int(),
      drawingPax: z.number().int().nullable(),
      detected: z.number().int(),
      placed: z.number().int(),
      interpolated: z.number().int(),
      surplusDropped: z.number().int(),
    }),
  ),
});
export type DetectionReport = z.infer<typeof detectionReportSchema>;
