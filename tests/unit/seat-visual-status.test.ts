import { describe, expect, it } from "vitest";

import {
  countsAsCapacity,
  countsAsOccupied,
  seatOccupantLabel,
  seatVisualStatus,
  type SeatVisualInput,
} from "@/lib/seat-visual-status";

const base: SeatVisualInput = {
  seatStatus: "bookable",
  assignedName: null,
  bookingStatus: null,
  occupantEmail: null,
  occupantName: null,
  viewerEmail: "viewer@cbva.in",
};

describe("seatVisualStatus", () => {
  it("shows a free bookable desk as available", () => {
    expect(seatVisualStatus(base)).toBe("available");
  });

  it("shows a colleague's confirmed booking as booked, not as yours", () => {
    expect(
      seatVisualStatus({
        ...base,
        bookingStatus: "confirmed",
        occupantEmail: "someone.else@cbva.in",
      }),
    ).toBe("booked");
  });

  it("shows your own confirmed booking as yours", () => {
    expect(
      seatVisualStatus({
        ...base,
        bookingStatus: "confirmed",
        occupantEmail: "viewer@cbva.in",
      }),
    ).toBe("your_booking");
  });

  it("distinguishes a colleague who has badged in", () => {
    expect(
      seatVisualStatus({
        ...base,
        bookingStatus: "checked_in",
        occupantEmail: "someone.else@cbva.in",
      }),
    ).toBe("checked_in");
  });

  it("keeps your own seat marked as yours once you have checked in", () => {
    // The gold rule marks the seat that is yours. Losing it the moment you
    // badge in would take the one cue you actually navigate by.
    expect(
      seatVisualStatus({
        ...base,
        bookingStatus: "checked_in",
        occupantEmail: "viewer@cbva.in",
      }),
    ).toBe("your_booking");
  });

  it.each(["cancelled_by_user", "completed_no_show"] as const)(
    "treats a %s booking as a free desk",
    (status) => {
      expect(
        seatVisualStatus({
          ...base,
          bookingStatus: status,
          occupantEmail: "someone.else@cbva.in",
        }),
      ).toBe("available");
    },
  );

  it("gives auto-released its own status rather than plain available", () => {
    // This is what makes the 2-hour rule visible on the plan at all.
    expect(
      seatVisualStatus({
        ...base,
        bookingStatus: "auto_released",
        occupantEmail: "someone.else@cbva.in",
      }),
    ).toBe("auto_released");
  });

  it("shows a fixed desk as reserved to everybody but its owner", () => {
    expect(
      seatVisualStatus({ ...base, seatStatus: "fixed", assignedName: "A Partner" }),
    ).toBe("reserved_fixed");
  });

  it("shows a fixed desk as yours to the person allocated it", () => {
    expect(
      seatVisualStatus({
        ...base,
        seatStatus: "fixed",
        bookingStatus: "confirmed",
        occupantEmail: "viewer@cbva.in",
      }),
    ).toBe("your_booking");
  });

  it.each(["blocked", "decommissioned"] as const)(
    "lets the desk's own %s state override any booking on it",
    (seatStatus) => {
      // A stale booking pointing at a decommissioned desk must not make it
      // look bookable, or the occupancy denominator is wrong.
      expect(
        seatVisualStatus({
          ...base,
          seatStatus,
          bookingStatus: "confirmed",
          occupantEmail: "viewer@cbva.in",
        }),
      ).toBe("blocked");
    },
  );

  it("does not call a seat yours when nobody is signed in", () => {
    expect(
      seatVisualStatus({
        ...base,
        viewerEmail: null,
        bookingStatus: "confirmed",
        occupantEmail: null,
      }),
    ).toBe("booked");
  });
});

describe("seatOccupantLabel", () => {
  it("names the occupant of a held booking", () => {
    expect(
      seatOccupantLabel({
        ...base,
        bookingStatus: "confirmed",
        occupantName: "Rhea Kulkarni",
      }),
    ).toBe("Rhea Kulkarni");
  });

  it("names the allocated person on a fixed desk with no booking", () => {
    expect(
      seatOccupantLabel({ ...base, seatStatus: "fixed", assignedName: "A Partner" }),
    ).toBe("A Partner");
  });

  it("names nobody on a free desk", () => {
    expect(seatOccupantLabel(base)).toBeNull();
  });

  it("does not name the occupant of a cancelled booking", () => {
    expect(
      seatOccupantLabel({
        ...base,
        bookingStatus: "cancelled_by_user",
        occupantName: "Rhea Kulkarni",
      }),
    ).toBeNull();
  });
});

describe("occupancy accounting", () => {
  it("counts only seats somebody actually holds", () => {
    expect(countsAsOccupied("booked")).toBe(true);
    expect(countsAsOccupied("checked_in")).toBe(true);
    expect(countsAsOccupied("your_booking")).toBe(true);
    expect(countsAsOccupied("available")).toBe(false);
    expect(countsAsOccupied("auto_released")).toBe(false);
    expect(countsAsOccupied("reserved_fixed")).toBe(false);
  });

  it("excludes blocked and fixed desks from bookable capacity", () => {
    // Capacity is the denominator every occupancy percentage is reported
    // against, so a fixed desk in it would understate utilisation.
    expect(countsAsCapacity("blocked")).toBe(false);
    expect(countsAsCapacity("reserved_fixed")).toBe(false);
    expect(countsAsCapacity("available")).toBe(true);
    expect(countsAsCapacity("booked")).toBe(true);
  });
});
