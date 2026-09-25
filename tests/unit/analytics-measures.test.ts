import { describe, expect, it } from "vitest";

import {
  BOOKED_STATUSES,
  CANCELLED_STATUSES,
  MEASURES,
  MEASURE_KEYS,
  TERMINAL_STATUS_LABELS,
} from "@/lib/analytics/measures";
import { bookingStatusEnum } from "@/lib/db/schema";

/**
 * THE REGRESSION TEST FOR THE MEASURE VOCABULARY.
 *
 * The SQL itself is proved against the real database in
 * tests/integration/analytics.test.ts — this file guards the parts that are
 * pure, and in particular the property that every booking status is accounted
 * for. An unaccounted status does not throw; it silently contributes nothing to
 * one measure and everything to another, which is exactly the kind of wrong
 * number this whole module exists to prevent.
 */
describe("the measure vocabulary", () => {
  const ALL = bookingStatusEnum.enumValues;

  it("accounts for every booking status exactly once", () => {
    // `checked_in` etc. appear in BOOKED; the two cancelled ones appear in
    // CANCELLED. Between them they must cover the enum with no overlap and no
    // gap — a status in neither is invisible to the report.
    const covered = [...BOOKED_STATUSES, ...CANCELLED_STATUSES].sort();
    expect(covered).toEqual([...ALL].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("excludes only the two cancellations from the booked measure", () => {
    expect([...CANCELLED_STATUSES].sort()).toEqual(
      ["cancelled_by_admin", "cancelled_by_user"].sort(),
    );
  });

  /**
   * `cancelled_after_check_in` counts as a claim on the desk, `cancelled_by_user`
   * does not, and the difference is not arbitrary: cancelBooking() applies the
   * cut-off unless the booking is already checked into, so a plain user
   * cancellation was always surrendered before its own slot began. One held the
   * desk during the slot it names; the other never did.
   */
  it("treats leaving early as a claim and cancelling early as not one", () => {
    expect(BOOKED_STATUSES).toContain("cancelled_after_check_in");
    expect(BOOKED_STATUSES).not.toContain("cancelled_by_user");
  });

  it("has an explainer for all three measures, with a caveat on each", () => {
    for (const key of MEASURE_KEYS) {
      const m = MEASURES[key];
      expect(m.label.length).toBeGreaterThan(3);
      // The caveat is the whole point of the explainer — a number whose limits
      // are not next to it is a number somebody quotes wrongly.
      expect(m.caveat.length).toBeGreaterThan(20);
      expect(m.counts.length).toBeGreaterThan(20);
    }
  });

  /**
   * ADR-024 and the Phase 3 handoff both insist these stay separate rather than
   * collapsing into "no show". Collapsing them is not a display simplification —
   * it changes the utilisation figure in the direction that looks plausible.
   */
  it("labels every terminal status the report can show", () => {
    for (const status of [
      "completed",
      "completed_no_show",
      "auto_released",
      "cancelled_by_user",
      "cancelled_after_check_in",
      "cancelled_by_admin",
    ]) {
      expect(TERMINAL_STATUS_LABELS[status]).toBeTruthy();
      expect(TERMINAL_STATUS_LABELS[status]!.meaning.length).toBeGreaterThan(10);
    }
  });

  it("gives the three measures distinct labels and units", () => {
    const labels = MEASURE_KEYS.map((k) => MEASURES[k].label);
    expect(new Set(labels).size).toBe(3);
    expect(MEASURES.seat_hours.unit).toBe("hours");
    expect(MEASURES.booked.unit).toBe("desks");
  });
});
