import { describe, expect, it } from "vitest";
import { DEFAULT_SLOT_DEFINITIONS, deriveSlotBounds } from "@/lib/slots";
import { BAYS, FIXED_SEAT_ALLOCATION, HEADCOUNT, TOTAL_HEADCOUNT, TOTAL_SEATS, seatCodes } from "@/lib/seed-data/inventory";

describe("deriveSlotBounds", () => {
  it("converts Asia/Kolkata wall time to UTC", () => {
    // IST is UTC+5:30, so a 09:00 local start is 03:30Z.
    const { startsAt, endsAt } = deriveSlotBounds("2026-09-03", "AM");
    expect(startsAt.toISOString()).toBe("2026-09-03T03:30:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-09-03T08:00:00.000Z");
  });

  it("gives PM a start that abuts the AM end", () => {
    const am = deriveSlotBounds("2026-09-03", "AM");
    const pm = deriveSlotBounds("2026-09-03", "PM");
    expect(pm.startsAt.toISOString()).toBe(am.endsAt.toISOString());
    expect(pm.endsAt.toISOString()).toBe("2026-09-03T13:30:00.000Z");
  });

  it("always produces a positive-length range", () => {
    for (const date of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
      for (const slot of ["AM", "PM"] as const) {
        const { startsAt, endsAt } = deriveSlotBounds(date, slot);
        expect(endsAt.getTime()).toBeGreaterThan(startsAt.getTime());
      }
    }
  });

  it("honours a custom slot definition", () => {
    const custom = {
      ...DEFAULT_SLOT_DEFINITIONS,
      AM: { label: "Early", start: "08:00", end: "12:00" },
    };
    const { startsAt } = deriveSlotBounds("2026-09-03", "AM", custom);
    expect(startsAt.toISOString()).toBe("2026-09-03T02:30:00.000Z");
  });
});

/**
 * The seed inventory has to reconcile against the CAD drawing exactly. If a bay
 * count is edited without the headcount following, analytics silently starts
 * reporting utilisation against the wrong denominator — and analytics is the
 * product.
 */
describe("seed inventory reconciliation", () => {
  it("totals 141 seats, matching the drawing's bay schedule", () => {
    expect(TOTAL_SEATS).toBe(141);
  });

  it("totals 141 people, matching the drawing's headcount", () => {
    expect(TOTAL_HEADCOUNT).toBe(141);
  });

  it("allocates exactly one fixed seat per fixed-grade person", () => {
    const fixedPeople = HEADCOUNT.filter((h) => h.seatMode === "fixed").reduce(
      (n, h) => n + h.count,
      0,
    );
    const fixedSeats = FIXED_SEAT_ALLOCATION.reduce((n, a) => n + a.codes.length, 0);
    expect(fixedPeople).toBe(47);
    expect(fixedSeats).toBe(47);
  });

  it("leaves one bookable seat for every person who must book", () => {
    const bookablePeople = HEADCOUNT.filter((h) => h.seatMode === "bookable").reduce(
      (n, h) => n + h.count,
      0,
    );
    const fixedSeats = FIXED_SEAT_ALLOCATION.reduce((n, a) => n + a.codes.length, 0);
    expect(bookablePeople).toBe(94);
    expect(TOTAL_SEATS - fixedSeats).toBe(94);
  });

  it("matches each fixed allocation block to its grade's headcount", () => {
    for (const alloc of FIXED_SEAT_ALLOCATION) {
      const bracket = HEADCOUNT.find((h) => h.grade === alloc.grade);
      expect(bracket, `no headcount bracket for ${alloc.grade}`).toBeDefined();
      expect(alloc.codes.length, `${alloc.grade} seat/people mismatch`).toBe(
        bracket!.count,
      );
    }
  });

  it("allocates only seat codes that actually exist", () => {
    const all = new Set(BAYS.flatMap(seatCodes));
    for (const alloc of FIXED_SEAT_ALLOCATION) {
      for (const code of alloc.codes) {
        expect(all.has(code), `${code} is not a real seat`).toBe(true);
      }
    }
  });

  it("never allocates the same seat twice", () => {
    const codes = FIXED_SEAT_ALLOCATION.flatMap((a) => a.codes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("keeps every passage seat bookable", () => {
    const allocated = new Set(FIXED_SEAT_ALLOCATION.flatMap((a) => a.codes));
    const passage = BAYS.filter((b) => b.prefix === "PA" || b.prefix === "PD").flatMap(seatCodes);
    expect(passage.length).toBe(34);
    for (const code of passage) expect(allocated.has(code)).toBe(false);
  });

  it("generates zero-padded seat codes", () => {
    const c1 = seatCodes(BAYS.find((b) => b.bay === "C1")!);
    expect(c1[0]).toBe("C1-01");
    expect(c1.at(-1)).toBe("C1-06");
  });
});
