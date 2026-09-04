import { Color } from "three";

import {
  SEAT_STATUS_TOKENS,
  type SeatVisualStatus,
} from "@/components/seat/seat-status";

/**
 * THE TOKEN BRIDGE — how the one colour map reaches three.js.
 *
 * ADR-010 says seat status is defined once and rendered everywhere from that
 * definition. The 2D plan gets there through Tailwind classes; a WebGL material
 * needs numbers. The tempting shortcut is a second table of hex values in this
 * file, and it is exactly the thing ADR-010 exists to prevent — it would drift
 * the first time somebody re-skins the palette.
 *
 * So this resolves the SAME `--seat-*` custom properties `globals.css` already
 * defines, at runtime, out of the live cascade. Change the palette and the 3D
 * view re-skins with everything else.
 *
 * The map below is keyed by `SeatVisualStatus` and typed `Record<...>`, so
 * adding an eighth status is a compile error here rather than a seat that
 * silently renders black.
 */
const CSS_VAR: Record<SeatVisualStatus, { fill: string; line: string }> = {
  available: { fill: "--seat-available-fill", line: "--seat-available-line" },
  booked: { fill: "--seat-booked-fill", line: "--seat-booked-line" },
  your_booking: { fill: "--seat-yours-fill", line: "--seat-yours-line" },
  reserved_fixed: { fill: "--seat-fixed-fill", line: "--seat-fixed-line" },
  checked_in: { fill: "--seat-checkedin-fill", line: "--seat-checkedin-line" },
  auto_released: { fill: "--seat-released-fill", line: "--seat-released-line" },
  blocked: { fill: "--seat-blocked-fill", line: "--seat-blocked-line" },
};

const CHROME_VAR = {
  paper: "--cbva-paper",
  gold: "--cbva-gold",
  navy: "--cbva-navy",
  hairline: "--cbva-hairline",
  inkSubtle: "--cbva-ink-subtle",
  surfaceSunken: "--cbva-surface-sunken",
  surface: "--cbva-surface",
} as const;

/**
 * Most of these tokens are `color-mix(...)`, and reading a custom property back
 * off an element returns the unresolved expression, which `THREE.Color` cannot
 * parse. Assigning it to a real `color` property and reading the COMPUTED value
 * makes the browser do the mixing and hand back `rgb(...)`.
 */
/**
 * DO NOT CONVERT THESE COLOUR SPACES BY HAND.
 *
 * `new Color("rgb(92, 95, 99)")` already lands in three's linear working space:
 * `ColorManagement` has been on by default since r155 and does the sRGB decode
 * while parsing. Calling `.convertSRGBToLinear()` afterwards decodes a second
 * time, and the error compounds in the dark half of the range — a mid-grey
 * chair at #5C5F63 came out very nearly black, which read as a lighting problem
 * and sent two rounds of fixes at the lights instead of at this line.
 */
function resolve(names: string[]): string[] {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.opacity = "0";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  try {
    return names.map((name) => {
      probe.style.color = "";
      probe.style.color = `var(${name})`;
      const value = getComputedStyle(probe).color;
      return value || "#000000";
    });
  } finally {
    probe.remove();
  }
}

export interface SeatPalette {
  status: Record<SeatVisualStatus, { fill: Color; line: Color }>;
  chrome: Record<keyof typeof CHROME_VAR, Color>;
}

export function readSeatPalette(): SeatPalette {
  const statuses = Object.keys(CSS_VAR) as SeatVisualStatus[];
  const chromeKeys = Object.keys(CHROME_VAR) as (keyof typeof CHROME_VAR)[];

  const names = [
    ...statuses.flatMap((s) => [CSS_VAR[s].fill, CSS_VAR[s].line]),
    ...chromeKeys.map((k) => CHROME_VAR[k]),
  ];
  const values = resolve(names);

  const status = {} as SeatPalette["status"];
  statuses.forEach((s, i) => {
    status[s] = {
      fill: new Color(values[i * 2]),
      line: new Color(values[i * 2 + 1]),
    };
  });

  const chrome = {} as SeatPalette["chrome"];
  chromeKeys.forEach((k, i) => {
    chrome[k] = new Color(values[statuses.length * 2 + i]);
  });

  return { status, chrome };
}

/**
 * The seven glyphs, in the order the atlas bakes them. Read off the token table
 * rather than retyped, for the same reason as the colours. `available` has no
 * glyph — its differentiator in 2D is the plain outline, and in 3D it is a desk
 * with nothing on it, which is the same statement.
 */
export const GLYPH_ORDER = Object.keys(CSS_VAR) as SeatVisualStatus[];

export function glyphFor(status: SeatVisualStatus): string | null {
  return SEAT_STATUS_TOKENS[status].glyph;
}

export function isInteractive(status: SeatVisualStatus): boolean {
  return SEAT_STATUS_TOKENS[status].interactive;
}
