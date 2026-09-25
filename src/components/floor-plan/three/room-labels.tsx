/**
 * Room labels in 3D, as FLOOR DECALS.
 *
 * WHY A DECAL AND NOT A FLOATING LABEL. Three reasons, in order of weight:
 *
 * 1. The top-down preset is the acceptance test for this whole view — press it
 *    and the model should resolve into the sheet CBVA handed us. A decal lies
 *    in the plan and reproduces the drawing. A billboard turns to face the
 *    camera and breaks exactly the moment the view is meant to prove itself.
 * 2. Cost. drei's <Text> is per-label SDF geometry and one draw call each.
 *    Nine labels would be nine, and a floor with thirty would spend half a
 *    budget of 60 on decoration.
 * 3. Subordination. These are context for the desks, which are the only thing
 *    anybody can act on. Lying flat keeps them quieter than anything standing
 *    up would be.
 *
 * The trade is foreshortening at a low orbit, which is acceptable: at the
 * default camera (about 37 degrees off vertical) they read, and the plan and
 * list views carry the same information as selectable text one control away.
 *
 * ONE DRAW CALL, and the geometry is why. Every label is a quad in world
 * space, and all of them are merged into a single BufferGeometry whose UVs
 * already point at that label's row of one strip atlas — the same merge the
 * walls use (ADR-030), and the same atlas trick the status glyphs use. Nine
 * labels or ninety, it stays one mesh and one texture. Per-instance UV offsets
 * would have needed a custom shader; baking them into the vertices needs
 * nothing.
 *
 * NOT INTERACTIVE, like everything else here that is not a desk.
 */
"use client";

import { useEffect, useMemo } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  LinearFilter,
  SRGBColorSpace,
  type Texture,
} from "three";

import { PLAN_LABELS, labelText } from "@/lib/floorplan-labels";

import { planToWorld } from "./coords";
import type { SeatPalette } from "./seat-materials";

/** One atlas ROW per label — a label is wide where a status glyph is square. */
const CELL_W = 1024;
const CELL_H = 128;

/** Metres. About the width of a meeting room, so a label sits inside its room. */
const LABEL_WIDTH = 8.6;
const LABEL_HEIGHT = (LABEL_WIDTH * CELL_H) / CELL_W;
/** Clear of the floor plane and its backing slab. */
const LIFT = 0.03;

/**
 * Labels draw OVER the scene rather than being buried by it.
 *
 * The first version lay on the floor with depth testing on and was invisible:
 * a boardroom table is 16 m long and 0.74 m high, so it covers its own label
 * completely, and a room full of chairs hides the rest. A label that the
 * furniture hides is not a label.
 *
 * So depth testing is off and the render order is last. They stay flat in the
 * plan — which is what keeps the top-down preset reproducing the drawing — but
 * they are never occluded. The cost is that at a low orbit a label can show
 * through the wing in front of it, which is how map labels behave anyway.
 */
const RENDER_ORDER = 10;

function buildLabelAtlas(ink: string): Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = CELL_W;
  canvas.height = CELL_H * PLAN_LABELS.length;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  PLAN_LABELS.forEach((label, i) => {
    const midY = i * CELL_H + CELL_H / 2;
    ctx.textBaseline = "alphabetic";
    ctx.font = `500 ${Math.round(CELL_H * 0.46)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(labelText(label), CELL_W / 2, midY + CELL_H * 0.44);
    // The bay code in mono, which is what the type rules reserve it for.
    ctx.font = `${Math.round(CELL_H * 0.3)}px ui-monospace, SFMono-Regular, monospace`;
    ctx.fillText(label.code, CELL_W / 2, midY - CELL_H * 0.06);
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** All label quads, flat on the floor, UVs baked to each label's atlas row. */
function buildLabelGeometry(): BufferGeometry {
  const n = PLAN_LABELS.length;
  const pos = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const index: number[] = [];
  const hw = LABEL_WIDTH / 2;
  const hh = LABEL_HEIGHT / 2;

  PLAN_LABELS.forEach((label, i) => {
    const [x, , z] = planToWorld(label.planX, label.planY);
    // Canvas rows run top-down; UV rows run bottom-up.
    const v1 = 1 - i / n;
    const v0 = 1 - (i + 1) / n;
    // Wound so the quad faces +Y, with +Z on screen-down under the top-down
    // camera — which is what keeps the text the right way up in plan.
    const corners: Array<[number, number, number, number]> = [
      [x - hw, z - hh, 0, v1],
      [x + hw, z - hh, 1, v1],
      [x + hw, z + hh, 1, v0],
      [x - hw, z + hh, 0, v0],
    ];
    corners.forEach(([cx, cz, u, v], k) => {
      const p = (i * 4 + k) * 3;
      pos[p] = cx;
      pos[p + 1] = LIFT;
      pos[p + 2] = cz;
      const q = (i * 4 + k) * 2;
      uv[q] = u;
      uv[q + 1] = v;
    });
    const b = i * 4;
    index.push(b, b + 2, b + 1, b, b + 3, b + 2);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

export function RoomLabels({ palette }: { palette: SeatPalette }) {
  const geometry = useMemo(() => buildLabelGeometry(), []);
  const atlas = useMemo(
    // Navy, not ink-subtle. Lying flat, a label is foreshortened at every camera
    // angle but straight down, so it needs more contrast than a label standing
    // up would. Navy is the drawing's own wall colour and is already in the
    // palette; it does not spend any gold.
    () => buildLabelAtlas(palette.chrome.navy.getStyle()),
    [palette],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      atlas?.dispose();
    };
  }, [geometry, atlas]);

  if (!atlas || PLAN_LABELS.length === 0) return null;

  return (
    <mesh geometry={geometry} raycast={() => null} renderOrder={RENDER_ORDER}>
      <meshBasicMaterial
        map={atlas}
        transparent
        toneMapped={false}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}
