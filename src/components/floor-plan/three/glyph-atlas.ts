import { CanvasTexture, LinearFilter, SRGBColorSpace, type Texture } from "three";

import { GLYPH_ORDER, glyphFor } from "@/components/floor-plan/three/seat-materials";

/**
 * The non-colour differentiator, carried into three dimensions.
 *
 * Roughly one man in twelve has a colour vision deficiency, and partners print
 * these screens in greyscale. In 2D each status carries a border treatment and
 * a glyph as well as a hue; a tinted box in a 3D scene would quietly drop both
 * and leave colour doing all the work — the one thing the design system says it
 * must never do.
 *
 * So every desk gets a small plate on it bearing its status glyph, baked into a
 * single strip texture. One instanced mesh, one draw call, per-instance UV
 * offset picking the cell. The glyph strings come from SEAT_STATUS_TOKENS.
 */
const CELL = 128;

export const GLYPH_CELLS = GLYPH_ORDER.length;

export function buildGlyphAtlas(ink: string): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = CELL * GLYPH_CELLS;
  canvas.height = CELL;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(CELL * 0.62)}px ui-sans-serif, system-ui, sans-serif`;
    GLYPH_ORDER.forEach((status, i) => {
      const glyph = glyphFor(status);
      if (!glyph) return;
      ctx.fillText(glyph, i * CELL + CELL / 2, CELL / 2 + CELL * 0.02);
    });
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/** Where a status sits in the strip, as a UV offset in [0, 1). */
export function glyphCellOffset(index: number): number {
  return index / GLYPH_CELLS;
}

export const GLYPH_CELL_WIDTH = 1 / GLYPH_CELLS;
