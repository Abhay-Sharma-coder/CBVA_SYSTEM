/**
 * npm run build:floorplan
 *
 * One command, two halves. The Python half reads the architect's PDF and
 * writes the geometry JSON plus an intermediate SVG of the whole drawing; this
 * half rasterises that SVG into the two webp textures the app actually ships,
 * then validates every JSON file against the same zod schemas the app parses
 * them with, so a bad build fails here rather than at runtime.
 *
 * The outputs are committed. Nobody needs to run this to work on the app.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import {
  detectionReportSchema,
  floorplanMetaSchema,
  seatAnchorsSchema,
  wallsSchema,
  zonesSchema,
} from "../src/lib/floorplan-schema";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "src", "data", "floorplan");
const PUBLIC = path.join(ROOT, "public", "floorplan");
const TEXTURE_WIDTHS = [2048, 4096] as const;

function python(): string {
  for (const candidate of ["python", "python3", "py"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  throw new Error("no python interpreter on PATH — needed to read the CAD PDF");
}

function extract() {
  const bin = python();
  const script = path.join(ROOT, "tools", "cad", "build_floorplan.py");
  const run = spawnSync(bin, [script], { stdio: "inherit" });
  if (run.status !== 0) {
    throw new Error(`${bin} ${script} exited ${run.status}`);
  }
}

async function rasterise() {
  const svgPath = path.join(DATA, "plan-texture.svg");
  if (!existsSync(svgPath)) throw new Error(`missing ${svgPath}`);
  const svg = readFileSync(svgPath);
  mkdirSync(PUBLIC, { recursive: true });

  for (const width of TEXTURE_WIDTHS) {
    const dest = path.join(PUBLIC, `plan-texture-${width}.webp`);
    // density scales librsvg's rasterisation of the source viewBox; without it
    // sharp renders at 72dpi and then upsamples, which smears the hairlines
    // that make a CAD drawing legible.
    const density = Math.round((72 * width) / 1285);
    await sharp(svg, { density, limitInputPixels: false })
      .resize({ width })
      .webp({ quality: 92, effort: 6 })
      .toFile(dest);
    const kb = statSync(dest).size / 1024;
    console.log(`  ${path.relative(ROOT, dest)}  ${kb.toFixed(0)} KB`);
  }
  // The intermediate is ~4 MB of CAD linework and is regenerable; the webps
  // are what ship.
  unlinkSync(svgPath);
}

function validate() {
  const read = (name: string) =>
    JSON.parse(readFileSync(path.join(DATA, name), "utf8")) as unknown;

  const meta = floorplanMetaSchema.parse(read("meta.json"));
  const walls = wallsSchema.parse(read("walls.json"));
  const zones = zonesSchema.parse(read("zones.json"));
  const seats = seatAnchorsSchema.parse(read("seats.json"));
  const report = detectionReportSchema.parse(read("detection-report.json"));

  const problems: string[] = [];
  if (seats.seats.length !== 141) {
    problems.push(`expected 141 seat anchors, got ${seats.seats.length}`);
  }
  if (walls.polygons.length > 400) {
    problems.push(`expected under 400 wall polygons, got ${walls.polygons.length}`);
  }
  if (zones.zones.length !== 4) {
    problems.push(`expected 4 zones, got ${zones.zones.length}`);
  }
  const codes = new Set(seats.seats.map((s) => s.seatCode));
  if (codes.size !== seats.seats.length) problems.push("duplicate seat codes");

  const b = meta.planBounds;
  for (const s of seats.seats) {
    if (
      s.planX < b.x ||
      s.planX > b.x + b.width ||
      s.planY < b.y ||
      s.planY > b.y + b.height
    ) {
      problems.push(`${s.seatCode} lies outside the plan bounds`);
      break;
    }
  }
  if (Object.keys(report.scheduleDrift).length > 0) {
    problems.push(
      `the drawing's PAX annotations disagree with the seed schedule: ${JSON.stringify(
        report.scheduleDrift,
      )}`,
    );
  }

  if (problems.length) {
    throw new Error(`floor plan build failed validation:\n  - ${problems.join("\n  - ")}`);
  }

  writeFileSync(
    path.join(DATA, "README.md"),
    [
      "# Generated — do not edit by hand",
      "",
      "`npm run build:floorplan` writes every file in this directory from",
      "`tools/cad/09 -R8 - NB -FURNITURE LAYOUT - 12-06-2025.pdf`.",
      "",
      `Source SHA-256: \`${meta.sourceSha256}\``,
      `Generator version: ${meta.generatorVersion}`,
      "",
      "`seats.json` is the source of truth for seat geometry: `npm run seed`",
      "reads it, and the editor at `/admin/floor-plan` writes back to it.",
      "",
    ].join("\n"),
  );

  console.log(
    `\nvalidated: ${seats.seats.length} seats, ${walls.polygons.length} wall polygons, ` +
      `${zones.zones.length} zones, scale ${meta.mmPerUnit ?? "unresolved"} mm/unit`,
  );
}

async function main() {
  extract();
  await rasterise();
  validate();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
