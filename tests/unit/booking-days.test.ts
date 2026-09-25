import { describe, expect, it } from "vitest";

import { bookableDates, bookableDays, isBookableDate, isWeekend } from "@/lib/booking-days";

/**
 * The booking window. Every case here is driven by an injected `now`, because
 * the clock rule means production reads it from the Clock and a test that
 * reached for the system date would be untestable on a Saturday.
 *
 * The window is expressed in WORKING days (settings.booking_window_working_days,
 * seeded 5) with a calendar-day ceiling (settings.booking_window_days, 14) so a
 * long run of holidays cannot walk the scan forward indefinitely.
 */

// A Monday, 09:00 in Asia/Kolkata.
const MONDAY = new Date("2026-09-07T03:30:00Z");

const base = { now: MONDAY, workingDays: 5, calendarBound: 14, holidays: new Set<string>() };

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

describe("bookableDates", () => {
  it("starts at today and runs forward for the configured working days", () => {
    const dates = bookableDates(base);
    expect(dates[0]).toBe("2026-09-07");
    expect(dates).toHaveLength(5);
  });

  it("skips the weekend", () => {
    // From a Monday, five working days lands on the Friday and never crosses.
    expect(bookableDates(base)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });

  /**
   * EDGE CASE 11 — the five working day window crossing a weekend AND an
   * Indian public holiday.
   *
   * Starting Thursday 10 September 2026 the window must step over Saturday and
   * Sunday, over Ganesh Chaturthi on the Monday, and land five WORKING days out
   * — which is a full week and a day of calendar time. Getting this wrong does
   * not throw; it quietly offers a day nobody is in the office, or refuses a
   * day they are.
   */
  it("crosses a weekend and a public holiday and still offers five working days", () => {
    const thursday = new Date("2026-09-10T03:30:00Z");
    const dates = bookableDates({
      ...base,
      now: thursday,
      // Ganesh Chaturthi 2026, from the seeded Maharashtra list.
      holidays: new Set(["2026-09-14"]),
    });

    expect(dates).toEqual([
      "2026-09-10", // Thu
      "2026-09-11", // Fri
      // 12th Sat, 13th Sun, 14th Ganesh Chaturthi — all skipped
      "2026-09-15", // Tue
      "2026-09-16", // Wed
      "2026-09-17", // Thu
    ]);
    expect(dates).not.toContain("2026-09-12");
    expect(dates).not.toContain("2026-09-13");
    expect(dates).not.toContain("2026-09-14");
    // Five working days spanned eight calendar days.
    expect(dates).toHaveLength(5);
  });

  it("stops at the calendar ceiling even when working days remain unfilled", () => {
    // Every weekday of the next fortnight is a holiday, so the scan runs out of
    // calendar before it runs out of working days. It must terminate, not loop.
    const holidays = new Set(
      Array.from({ length: 20 }, (_, i) =>
        new Date(MONDAY.getTime() + i * 86_400_000).toISOString().slice(0, 10),
      ),
    );
    expect(bookableDates({ ...base, holidays })).toEqual([]);
  });

  it("honours the working-day count from settings rather than a hardcoded 5", () => {
    expect(bookableDates({ ...base, workingDays: 2 })).toEqual([
      "2026-09-07",
      "2026-09-08",
    ]);
  });

  it("uses the office's calendar day, not the server's", () => {
    // 20:00 UTC on the Sunday is already Monday morning in Mumbai. A server in
    // UTC must still offer the Monday.
    const sundayEvening = new Date("2026-09-06T20:00:00Z");
    expect(bookableDates({ ...base, now: sundayEvening })[0]).toBe("2026-09-07");
  });
});

describe("isBookableDate", () => {
  it("accepts a date inside the window and refuses one outside it", () => {
    expect(isBookableDate("2026-09-11", base)).toBe(true);
    // The sixth working day is offered by nothing, so the write path must
    // refuse it — this is what stops a hand-edited URL booking any date at all.
    expect(isBookableDate("2026-09-14", base)).toBe(false);
  });

  it("refuses a weekend, a holiday and yesterday", () => {
    expect(isBookableDate("2026-09-12", base)).toBe(false);
    expect(isBookableDate("2026-09-09", { ...base, holidays: new Set(["2026-09-09"]) })).toBe(
      false,
    );
    expect(isBookableDate("2026-09-04", base)).toBe(false);
  });
});

describe("bookableDays", () => {
  it("decorates the same dates for the strip", () => {
    const days = bookableDays(base);
    expect(days.map((d) => d.date)).toEqual(bookableDates(base));
    expect(days[0]?.isToday).toBe(true);
    expect(days[0]?.weekdayLabel).toBe("Mon");
    expect(days[0]?.dayLabel).toBe("7");
    expect(days[0]?.monthLabel).toBe("Sep");
  });

  it("marks nothing as today when today is not bookable", () => {
    const days = bookableDays({ ...base, holidays: new Set(["2026-09-07"]) });
    expect(days[0]?.date).toBe("2026-09-08");
    expect(days.some((d) => d.isToday)).toBe(false);
  });
});
