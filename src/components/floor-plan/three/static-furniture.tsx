/**
 * Static furniture — the boardroom and meeting room tables, both lounges, the
 * foldable tables, the storage credenzas, the planters.
 *
 * WHY THIS EXISTS. The renderer draws a mesh only where a BOOKABLE SEAT
 * exists. Zone A is a 25-person boardroom, four meeting rooms, a lounge and
 * storage; Zone B is a flexible room with eight foldable tables on castors, a
 * sofa lounge and a run of storage credenzas. Neither has a single bookable
 * desk, so both wings rendered as bare plate — which reads as broken rather
 * than as "that wing is meeting rooms". No seat is added to fix that: there
 * are no seats there. This is context for the seats that do exist.
 *
 * THE RULE THAT MATTERS MOST: none of this is interactive. Every mesh sets
 * `raycast={() => null}` and nothing enters the DOM. The moment non-bookable
 * furniture becomes clickable, somebody tries to book the boardroom from the
 * floor plan and two deliberately separate flows merge into one.
 *
 * One `<Instances>` per kind over a shared unit box, scaled per instance: four
 * draw calls for 318 objects. Colour comes from the chrome tokens, never from
 * `SEAT_STATUS_TOKENS` — this furniture has no status and must never look as
 * though it has one.
 */
"use client";

import { useMemo } from "react";
import { Instance, Instances } from "@react-three/drei";
import { BoxGeometry } from "three";

import { floorplanFurniture } from "@/lib/floorplan";
import type { FurnitureKind } from "@/lib/floorplan-schema";

import { DIMENSIONS, planLength, planToWorld } from "./coords";
import type { SeatPalette } from "./seat-materials";

const HEIGHT: Record<FurnitureKind, number> = {
  table: DIMENSIONS.tableHeight,
  seating: DIMENSIONS.seatingHeight,
  planter: DIMENSIONS.planterHeight,
  modular: DIMENSIONS.modularHeight,
};

/**
 * Subordinate on purpose. These read as pale volumes a shade off the floor,
 * so the eye still goes to the desks — which are the only things anybody can
 * act on. Planters take the one slightly different tone, because a plant that
 * is the same colour as a table is just a small table.
 */
function tint(kind: FurnitureKind, palette: SeatPalette) {
  return kind === "planter" ? palette.chrome.hairline : palette.chrome.surfaceSunken;
}

const KINDS: FurnitureKind[] = ["table", "seating", "planter", "modular"];

export function StaticFurniture({ palette }: { palette: SeatPalette }) {
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const byKind = useMemo(() => {
    const out = new Map<FurnitureKind, typeof floorplanFurniture.items>();
    for (const item of floorplanFurniture.items) {
      const list = out.get(item.kind);
      if (list) list.push(item);
      else out.set(item.kind, [item]);
    }
    return out;
  }, []);

  return (
    <group>
      {KINDS.map((kind) => {
        const items = byKind.get(kind);
        if (!items || items.length === 0) return null;
        const height = HEIGHT[kind];
        return (
          <Instances
            key={kind}
            geometry={geometry}
            limit={items.length}
            range={items.length}
            castShadow
            receiveShadow
            // Not pickable, and not reachable. The seats are the only thing on
            // this floor anybody can act on.
            raycast={() => null}
          >
            <meshStandardMaterial
              color={tint(kind, palette)}
              roughness={0.9}
              metalness={0}
            />
            {items.map((item, i) => {
              const [x, , z] = planToWorld(item.x, item.y);
              return (
                <Instance
                  key={`${kind}-${i}`}
                  position={[x, height / 2, z]}
                  // Plan rotation is about +Y down; world is +Y up, so it
                  // negates exactly as a seat's does. One conversion, in
                  // coords.ts, and this is the same one.
                  rotation={[0, (-item.rotationDeg * Math.PI) / 180, 0]}
                  scale={[planLength(item.w), height, planLength(item.h)]}
                />
              );
            })}
          </Instances>
        );
      })}
    </group>
  );
}
