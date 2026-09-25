import { describe, expect, it } from "vitest";

import type { FloorPlanSeat } from "@/components/floor-plan/types";
import {
  LOD_2D_ENTER_BAY,
  LOD_2D_EXIT_BAY,
  LOD_3D_ENTER_BAY,
  LOD_3D_EXIT_BAY,
  bayOccupancy,
  occupancyFraction,
  resolveLod,
  type LodLevel,
} from "@/lib/floor-plan-lod";
import type { SeatVisualStatus } from "@/components/seat/seat-status";

function seat(
  seatCode: string,
  bay: string,
  status: SeatVisualStatus,
  planX = 100,
  planY = 200,
): FloorPlanSeat {
  return {
    seatCode,
    bay,
    zone: "C",
    planX,
    planY,
    rotationDeg: 0,
    seatType: "workstation",
    seatStatus: "bookable",
    status,
    occupantName: null,
    releasedByOwner: false,
    bookingId: null,
    bookingUpdatedAt: null,
    anchorSource: "detected",
  };
}

describe("LOD thresholds", () => {
  it("2D switches to bay detail where the marker stops shrinking", () => {
    // plan-canvas sizes a marker min(34, max(13, scale*16)), so 13/16 = 0.8125
    // is the scale below which the chip is pinned while the desk pitch keeps
    // shrinking. The enter threshold must sit at or above that point, or the
    // switch happens after the chips have already started colliding.
    expect(LOD_2D_ENTER_BAY).toBeGreaterThanOrEqual(13 / 16);
  });

  it("has a real hysteresis band in both views", () => {
    expect(LOD_2D_EXIT_BAY).toBeGreaterThan(LOD_2D_ENTER_BAY);
    expect(LOD_3D_ENTER_BAY).toBeGreaterThan(LOD_3D_EXIT_BAY);
  });
});

describe("resolveLod — zoom-like (2D, smaller is further away)", () => {
  const r = (prev: LodLevel, v: number) =>
    resolveLod(prev, v, LOD_2D_ENTER_BAY, LOD_2D_EXIT_BAY);

  it("shows bay detail when zoomed right out", () => {
    expect(r("seat", 0.4)).toBe("bay");
    expect(r("bay", 0.4)).toBe("bay");
  });

  it("shows seat detail when zoomed in", () => {
    expect(r("bay", 2.5)).toBe("seat");
    expect(r("seat", 2.5)).toBe("seat");
  });

  it("HOLDS inside the band, which is the whole point", () => {
    // A settling spring or a drifting trackpad crosses one threshold many
    // times. Without hysteresis the plan flickers between two renderings,
    // which is worse than committing to either.
    const mid = (LOD_2D_ENTER_BAY + LOD_2D_EXIT_BAY) / 2;
    expect(r("bay", mid)).toBe("bay");
    expect(r("seat", mid)).toBe("seat");
  });

  it("does not flip until the far threshold is crossed", () => {
    // Coming from bay detail, passing ENTER is not enough — only EXIT flips it.
    let level: LodLevel = "bay";
    level = r(level, LOD_2D_ENTER_BAY + 0.01);
    expect(level).toBe("bay");
    level = r(level, LOD_2D_EXIT_BAY + 0.01);
    expect(level).toBe("seat");
    // and symmetrically on the way back out
    level = r(level, LOD_2D_EXIT_BAY - 0.01);
    expect(level).toBe("seat");
    level = r(level, LOD_2D_ENTER_BAY - 0.01);
    expect(level).toBe("bay");
  });
});

describe("resolveLod — distance-like (3D, larger is further away)", () => {
  const r = (prev: LodLevel, v: number) =>
    resolveLod(prev, v, LOD_3D_ENTER_BAY, LOD_3D_EXIT_BAY);

  it("shows bay detail at whole-floor distance and seats up close", () => {
    expect(r("seat", 110)).toBe("bay");
    expect(r("bay", 20)).toBe("seat");
  });

  it("holds inside the band", () => {
    const mid = (LOD_3D_ENTER_BAY + LOD_3D_EXIT_BAY) / 2;
    expect(r("bay", mid)).toBe("bay");
    expect(r("seat", mid)).toBe("seat");
  });
});

describe("bayOccupancy", () => {
  it("normalises against the bay's own capacity, not its size", () => {
    // The Phase 5 defect this exists to prevent: an undivided count makes
    // every big bay look busy and draws a picture of which bays are biggest.
    const seats = [
      ...Array.from({ length: 18 }, (_, i) =>
        seat(`PD-${i + 1}`, "PD", i < 6 ? "booked" : "available"),
      ),
      seat("D5-01", "D5", "booked"),
    ];
    const [d5, pd] = bayOccupancy(seats);
    expect(d5.bay).toBe("D5");
    expect(pd.bay).toBe("PD");

    expect(pd.occupied).toBe(6);
    expect(occupancyFraction(pd)).toBeCloseTo(6 / 18);
    expect(occupancyFraction(d5)).toBe(1);
    // PD has six times the occupied desks and is a THIRD as full.
    expect(pd.occupied).toBeGreaterThan(d5.occupied);
    expect(occupancyFraction(pd)!).toBeLessThan(occupancyFraction(d5)!);
  });

  it("counts the three occupied statuses and no others", () => {
    const seats = [
      seat("C4-01", "C4", "booked"),
      seat("C4-02", "C4", "checked_in"),
      seat("C4-03", "C4", "your_booking"),
      seat("C4-04", "C4", "available"),
      seat("C4-05", "C4", "auto_released"),
    ];
    const [c4] = bayOccupancy(seats);
    expect(c4.occupied).toBe(3);
    expect(c4.capacity).toBe(5);
  });

  it("excludes fixed and blocked desks from capacity but still draws them", () => {
    const seats = [
      seat("C3-01", "C3", "reserved_fixed"),
      seat("C3-02", "C3", "reserved_fixed"),
      seat("C3-03", "C3", "blocked"),
    ];
    const [c3] = bayOccupancy(seats);
    expect(c3.desks).toBe(3);
    expect(c3.capacity).toBe(0);
    // A bay with no bookable supply is not 0% full, it is not a question --
    // and the chip must render an em dash rather than divide by zero.
    expect(occupancyFraction(c3)).toBeNull();
  });

  it("puts the chip at the centroid of the bay's own desks", () => {
    const seats = [
      seat("C5-01", "C5", "available", 100, 200),
      seat("C5-02", "C5", "available", 200, 400),
    ];
    const [c5] = bayOccupancy(seats);
    expect(c5.planX).toBe(150);
    expect(c5.planY).toBe(300);
  });
});
