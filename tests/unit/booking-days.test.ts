import { describe, expect, it } from "vitest";

import { bookableDays, isWeekend } from "@/lib/booking-days";

/**
 * The date strip. Every case here is driven by an injected `now`, because the
 * clock rule means production reads it from the Clock and a test that reached
 * for the system date would be untestable on a Saturday.
 */

// A Monday, 09:00 in Asia/Kolkata.
const MONDAY = new Date("2026-09-07T03:30:00Z");

describe("isWeekend", () => {
  it("recognises Saturday and Sunday", () => {
    expect(isWeekend("2026-09-12")).toBe(true);
    expect(isWeekend("2026-09-13")).toBe(true);
  });

  it("passes weekdays through", () => {
    for (const d of ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]) {
      expect(isWeekend(d)).toBe(false);
    }
  });
});

describe("bookableDays", () => {
  it("starts at today and runs forward", () => {
    const days = bookableDays({ now: MONDAY, windowDays: 14, holidays: new Set() });
    expect(days[0]?.date).toBe("2026-09-07");
    expect(days[0]?.isToday).toBe(true);
    expect(days).toHaveLength(6);
  });

  it("skips the weekend", () => {
    const days = bookableDays({ now: MONDAY, windowDays: 14, holidays: new Set() });
    const dates = days.map((d) => d.date);
    expect(dates).not.toContain("2026-09-12");
    expect(dates).not.toContain("2026-09-13");
    expect(dates).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-14",
    ]);
  });

  it("skips holidays", () => {
    // Ganesh Chaturthi 2026 falls on the Monday after that first week.
    const days = bookableDays({
      now: MONDAY,
      windowDays: 14,
      holidays: new Set(["2026-09-14"]),
    });
    const dates = days.map((d) => d.date);
    expect(dates).not.toContain("2026-09-14");
    expect(dates[5]).toBe("2026-09-15");
  });

  it("respects the booking window from settings rather than a hardcoded 5", () => {
    const days = bookableDays({ now: MONDAY, windowDays: 2, holidays: new Set() });
    expect(days.map((d) => d.date)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ]);
  });

  it("marks nothing as today when today is not bookable", () => {
    // A holiday that happens to be today: the strip still offers the next
    // working days, but none of them is today.
    const days = bookableDays({
      now: MONDAY,
      windowDays: 14,
      holidays: new Set(["2026-09-07"]),
    });
    expect(days[0]?.date).toBe("2026-09-08");
    expect(days.some((d) => d.isToday)).toBe(false);
  });

  it("returns nothing when the whole window is closed", () => {
    const holidays = new Set(
      Array.from({ length: 20 }, (_, i) => {
        const d = new Date(MONDAY.getTime() + i * 86_400_000);
        return d.toISOString().slice(0, 10);
      }),
    );
    expect(bookableDays({ now: MONDAY, windowDays: 14, holidays })).toEqual([]);
  });

  it("labels each day for the strip", () => {
    const [first] = bookableDays({ now: MONDAY, windowDays: 14, holidays: new Set() });
    expect(first?.weekdayLabel).toBe("Mon");
    expect(first?.dayLabel).toBe("7");
    expect(first?.monthLabel).toBe("Sep");
  });

  it("uses the office's calendar day, not the server's", () => {
    // 20:00 UTC on the Sunday is already Monday morning in Mumbai. A server in
    // UTC must still offer the Monday.
    const sundayEvening = new Date("2026-09-06T20:00:00Z");
    const days = bookableDays({
      now: sundayEvening,
      windowDays: 14,
      holidays: new Set(),
    });
    expect(days[0]?.date).toBe("2026-09-07");
  });
});
