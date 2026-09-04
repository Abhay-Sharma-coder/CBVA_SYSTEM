import { BoxGeometry, BufferGeometry, Matrix4, Quaternion, Vector3 } from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { DIMENSIONS, METRES_PER_UNIT, planToWorld } from "@/components/floor-plan/three/coords";
import { floorplanWalls } from "@/lib/floorplan";
import type { WallLayer } from "@/lib/floorplan-schema";

/**
 * walls.json -> one merged mesh per class.
 *
 * WHY SEGMENT BOXES AND NOT `THREE.Shape` + `ExtrudeGeometry` (ADR-030).
 *
 * ExtrudeGeometry needs a SIMPLE CLOSED shape: earcut triangulates the outline
 * and silently produces holes, inverted faces or NaN vertices when the outline
 * self-touches or does not close. 437 of the 534 chains in walls.json are open
 * polylines, and several closed ones touch themselves at junctions where two
 * corridors meet — CAD linework chained end to end has no obligation to be a
 * simple polygon, and this one is not.
 *
 * So each SEGMENT becomes one oriented box, and the boxes merge. It is the same
 * silhouette, it cannot fail to triangulate, a chain that doubles back merely
 * overlaps itself, and after merging it is still one draw call per class.
 *
 * 1,431 segments -> ~34k triangles across three meshes. Built once, in a
 * `useMemo`, never per frame.
 */

const UNIT_BOX = new BoxGeometry(1, 1, 1);

const CLASS_SIZE: Record<WallLayer, { height: number; thickness: number }> = {
  wall: { height: DIMENSIONS.wallHeight, thickness: DIMENSIONS.wallThickness },
  partition: {
    height: DIMENSIONS.partitionHeight,
    thickness: DIMENSIONS.partitionThickness,
  },
  glazing: { height: DIMENSIONS.glazingHeight, thickness: DIMENSIONS.glazingThickness },
};

/** Segments shorter than this contribute nothing but vertices. */
const MIN_SEGMENT_METRES = 0.05;

export function buildWallGeometry(layer: WallLayer): BufferGeometry | null {
  const { height, thickness } = CLASS_SIZE[layer];
  const parts: BufferGeometry[] = [];

  const a = new Vector3();
  const b = new Vector3();
  const mid = new Vector3();
  const dir = new Vector3();
  const up = new Vector3(0, 1, 0);
  const quat = new Quaternion();
  const matrix = new Matrix4();
  const scale = new Vector3();

  for (const polygon of floorplanWalls.polygons) {
    if (polygon.layer !== layer) continue;

    const points = polygon.points;
    // A closed chain still needs its last-to-first segment drawn; the file
    // records closure as a flag rather than repeating the vertex.
    const count = polygon.closed ? points.length : points.length - 1;

    for (let i = 0; i < count; i += 1) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      a.set(...planToWorld(p[0], p[1]));
      b.set(...planToWorld(q[0], q[1]));

      const length = a.distanceTo(b);
      if (length < MIN_SEGMENT_METRES) continue;

      // One shared unit box, scaled to the segment and rotated about Y to its
      // bearing, sitting at the midpoint with its base on the floor. Scaling a
      // single geometry beats constructing 1,431 BoxGeometries.
      //
      // The overrun of one thickness is deliberate: it closes the notch every
      // corner would otherwise show between two boxes meeting at an angle.
      dir.subVectors(b, a);
      quat.setFromAxisAngle(up, Math.atan2(dir.x, dir.z) - Math.PI / 2);

      mid.addVectors(a, b).multiplyScalar(0.5);
      mid.y = height / 2;

      scale.set(length + thickness, height, thickness);
      matrix.compose(mid, quat, scale);
      parts.push(UNIT_BOX.clone().applyMatrix4(matrix));
    }
  }

  if (parts.length === 0) return null;
  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Reported in the handoff, and asserted by the perf e2e. */
export function wallSegmentCount(): Record<WallLayer, number> {
  const out: Record<WallLayer, number> = { wall: 0, partition: 0, glazing: 0 };
  for (const p of floorplanWalls.polygons) {
    out[p.layer] += p.closed ? p.points.length : p.points.length - 1;
  }
  return out;
}

/** Metres, for the handoff's "is this the real building" sanity line. */
export const WALL_METRES_PER_UNIT = METRES_PER_UNIT;
