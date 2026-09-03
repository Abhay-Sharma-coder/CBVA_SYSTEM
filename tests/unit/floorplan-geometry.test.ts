import { describe, expect, it } from "vitest";

import { BAYS, TOTAL_SEATS, seatCodes } from "@/lib/seed-data/inventory";
import {
  FULL_FLOOR_BOUNDS,
  PLAN_BOUNDS,
  floorplanDetectedModules,
  floorplanDetectionReport,
  floorplanMeta,
  floorplanSeatAnchors,
  floorplanWalls,
  floorplanZones,
  nearestDetectedModule,
  seatAnchor,
} from "@/lib/floorplan";

/**
 * Guards on the generated CAD geometry.
 *
 * These are not testing the extractor's arithmetic — they are the contract
 * between `npm run build:floorplan` and everything downstream. If somebody
 * regenerates the geometry from a revised drawing and a bay changes size, or a
 * seat lands outside the building, this is where it stops.
 */
describe("generated floor plan geometry", () => {
  it("carries an anchor for every seat in the bay schedule, and no others", () => {
    const expected = BAYS.flatMap(seatCodes).sort();
    const actual = floorplanSeatAnchors.seats.map((s) => s.seatCode).sort();
    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(TOTAL_SEATS);
  });

  it("agrees with the bay schedule on every bay's size", () => {
    for (const bay of BAYS) {
      const placed = floorplanSeatAnchors.seats.filter((s) => s.bay === bay.bay);
      expect(placed, `bay ${bay.bay}`).toHaveLength(bay.count);
    }
  });

  it("puts every seat inside the plan bounds", () => {
    for (const seat of floorplanSeatAnchors.seats) {
      expect(seat.planX).toBeGreaterThanOrEqual(PLAN_BOUNDS.x);
      expect(seat.planX).toBeLessThanOrEqual(PLAN_BOUNDS.x + PLAN_BOUNDS.width);
      expect(seat.planY).toBeGreaterThanOrEqual(PLAN_BOUNDS.y);
      expect(seat.planY).toBeLessThanOrEqual(PLAN_BOUNDS.y + PLAN_BOUNDS.height);
    }
  });

  it("does not stack two seats on the same spot", () => {
    // Detection assigning two seats to one chair is the failure mode that
    // would be invisible on screen and wrong in the analytics.
    const seen = new Set<string>();
    for (const seat of floorplanSeatAnchors.seats) {
      const key = `${seat.planX.toFixed(1)},${seat.planY.toFixed(1)}`;
      expect(seen.has(key), `${seat.seatCode} duplicates a position`).toBe(false);
      seen.add(key);
    }
  });

  it("keeps every seat in a bay near its bay-mates", () => {
    // A seat assigned to the wrong wing would sit hundreds of units from the
    // rest of its bay. Passage runs are long, so the bound is generous.
    for (const bay of BAYS) {
      const inBay = floorplanSeatAnchors.seats.filter((s) => s.bay === bay.bay);
      const cx = inBay.reduce((n, s) => n + s.planX, 0) / inBay.length;
      const cy = inBay.reduce((n, s) => n + s.planY, 0) / inBay.length;
      for (const seat of inBay) {
        const d = Math.hypot(seat.planX - cx, seat.planY - cy);
        expect(d, `${seat.seatCode} is ${d.toFixed(0)} from its bay centre`).toBeLessThan(
          220,
        );
      }
    }
  });

  it("gives every seat a rotation in range", () => {
    for (const seat of floorplanSeatAnchors.seats) {
      expect(seat.rotationDeg).toBeGreaterThanOrEqual(0);
      expect(seat.rotationDeg).toBeLessThan(360);
      expect(Number.isInteger(seat.rotationDeg)).toBe(true);
    }
  });

  it("stays under the wall polygon budget Phase 4 extrudes", () => {
    expect(floorplanWalls.polygons.length).toBeLessThan(400);
    expect(floorplanWalls.polygons.length).toBeGreaterThan(50);
  });

  it("describes all four wings", () => {
    expect(floorplanZones.zones.map((z) => z.code).sort()).toEqual(["A", "B", "C", "D"]);
    for (const zone of floorplanZones.zones) {
      expect(zone.polygon.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("frames a floor larger than any single wing", () => {
    expect(FULL_FLOOR_BOUNDS.width).toBeGreaterThan(400);
    expect(FULL_FLOOR_BOUNDS.height).toBeGreaterThan(400);
  });

  it("records the source drawing's checksum so a revision is detectable", () => {
    expect(floorplanMeta.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(floorplanMeta.source).toContain(".pdf");
  });

  it("resolves the plot scale to something a desk-sized object fits", () => {
    // 1:200 on a 72dpi page. A workstation pitch of ~23 plan units has to come
    // out as roughly 1.5m or the scale is wrong and Phase 4 will build a
    // dolls' house.
    expect(floorplanMeta.mmPerUnit).not.toBeNull();
    const pitchMm = 23 * (floorplanMeta.mmPerUnit ?? 0);
    expect(pitchMm).toBeGreaterThan(1200);
    expect(pitchMm).toBeLessThan(2000);
  });
});

describe("detection report", () => {
  it("reconciles to 141 seats", () => {
    const placed = floorplanDetectionReport.bays.reduce((n, b) => n + b.placed, 0);
    expect(placed).toBe(TOTAL_SEATS);
  });

  it("never silently drops a detected desk", () => {
    for (const bay of floorplanDetectionReport.bays) {
      expect(bay.detected + bay.interpolated - bay.surplusDropped).toBe(bay.expected);
    }
  });

  it("records no drift between the drawing's pax counts and the schedule", () => {
    expect(floorplanDetectionReport.scheduleDrift).toEqual({});
  });

  it("carries the drawing's own headline total and its exclusion note", () => {
    // The title block is a third source for 141, independent of both the
    // per-bay pax annotations and the furniture schedule. The note is what
    // explains why zone A's conference rooms hold chairs but no seats.
    expect(floorplanDetectionReport.sheetTotalWorkingPeople).toBe(TOTAL_SEATS);
    expect(floorplanDetectionReport.sheetExclusionNote).toBe(
      "NOTE: CONFERENCE AREA AND CAFETERIA NOT INCLUDED.",
    );
  });

  it("is explicit about which bays the drawing does not confirm", () => {
    // A1 and A2 carry no PAX annotation, so those 8 seats rest on our
    // assumption. The report must keep saying so.
    expect(floorplanDetectionReport.baysWithoutDrawingPax).toEqual(["A1", "A2"]);
    expect(floorplanDetectionReport.seatsConfirmedByDrawingPax).toBe(133);
  });

  it("reports zone B's unscheduled chairs rather than hiding them", () => {
    expect(floorplanDetectionReport.zoneBExpected).toBe(0);
    expect(floorplanDetectionReport.zoneBChairsDetected).toBeGreaterThan(0);
  });
});

describe("editor helpers", () => {
  it("finds a seat's anchor by code", () => {
    expect(seatAnchor("C3-01")?.bay).toBe("C3");
    expect(seatAnchor("NOPE-99")).toBeUndefined();
  });

  it("snaps to a detected module when one is close", () => {
    const seat = floorplanSeatAnchors.seats.find((s) => s.source === "detected");
    expect(seat).toBeDefined();
    const hit = nearestDetectedModule(seat!.planX, seat!.planY, 5);
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeLessThan(5);
  });

  it("declines to snap when nothing is near", () => {
    expect(nearestDetectedModule(PLAN_BOUNDS.x + 1, PLAN_BOUNDS.y + 1, 10)).toBeNull();
  });

  it("keeps unassigned modules available to snap to", () => {
    // The whole point of exporting every detected module, not just the
    // assigned ones: where assignment failed is where snapping is needed.
    expect(floorplanDetectedModules.modules.length).toBeGreaterThan(
      floorplanSeatAnchors.seats.filter((s) => s.source === "detected").length,
    );
  });
});
