"use client";

import { useEffect, useMemo } from "react";
import type { BufferGeometry, Color } from "three";

import { buildWallGeometry } from "@/components/floor-plan/three/wall-geometry";
import type { WallLayer } from "@/lib/floorplan-schema";

/**
 * The shell: three merged meshes, three draw calls, built once.
 *
 * Each class gets its own height and material because that is the information
 * the drawing carries and a single grey extrusion throws away — a full-height
 * wall you cannot see past, a desk-height partition you can, and glazing that
 * is glass. Heights are invented (ASSUMPTIONS A23) but the CLASSES are the
 * architect's own CAD layers, so when CBVA gives us real dimensions only three
 * numbers change.
 *
 * Materials are flat and matte on purpose. This should read as an architectural
 * drawing stood up, not as a rendering: no specular highlights, no reflections,
 * nothing that competes with the linework on the floor.
 */
export interface WallPalette {
  wall: Color;
  partition: Color;
  glazing: Color;
}

const ORDER: WallLayer[] = ["wall", "partition", "glazing"];

export function Walls({ palette }: { palette: WallPalette }) {
  const geometries = useMemo(() => {
    const out: Array<[WallLayer, BufferGeometry]> = [];
    for (const layer of ORDER) {
      const geometry = buildWallGeometry(layer);
      if (geometry) out.push([layer, geometry]);
    }
    return out;
  }, []);

  useEffect(
    () => () => {
      geometries.forEach(([, g]) => g.dispose());
    },
    [geometries],
  );

  return (
    <group>
      {geometries.map(([layer, geometry]) =>
        layer === "glazing" ? (
          <mesh key={layer} geometry={geometry}>
            <meshStandardMaterial
              color={palette.glazing}
              transparent
              opacity={0.16}
              roughness={0.1}
              metalness={0}
              depthWrite={false}
            />
          </mesh>
        ) : (
          <mesh key={layer} geometry={geometry} castShadow receiveShadow>
            <meshStandardMaterial
              color={layer === "wall" ? palette.wall : palette.partition}
              roughness={0.95}
              metalness={0}
              flatShading
            />
          </mesh>
        ),
      )}
    </group>
  );
}
