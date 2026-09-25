import { describe, expect, it } from "vitest";
import { DemoClock, SystemClock, type Clock } from "@/lib/clock";

/** A Clock frozen at an instant — what every time-dependent test will use. */
class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return this.instant;
  }
}

describe("Clock", () => {
  const base = new Date("2026-09-03T09:00:00.000Z");

  it("SystemClock returns the real time", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThan(before + 5_000);
  });

  it("DemoClock offsets its base clock", () => {
    const clock = new DemoClock(2 * 3600, new FixedClock(base));
    expect(clock.now().toISOString()).toBe("2026-09-03T11:00:00.000Z");
  });

  it("a zero offset is a passthrough", () => {
    expect(new DemoClock(0, new FixedClock(base)).now()).toEqual(base);
  });

  it("offsets backwards as well as forwards", () => {
    const clock = new DemoClock(-90 * 60, new FixedClock(base));
    expect(clock.now().toISOString()).toBe("2026-09-03T07:30:00.000Z");
  });

  it("exposes its offset so the UI can say the clock is shifted", () => {
    expect(new DemoClock(7200).offset).toBe(7200);
  });

  it("does not mutate the base instant", () => {
    const instant = new Date(base);
    const clock = new DemoClock(3600, new FixedClock(instant));
    clock.now();
    clock.now();
    expect(instant.toISOString()).toBe(base.toISOString());
  });

  /**
   * The behaviour the whole pattern exists for: advance the demo clock by the
   * auto-release window and a booking that has not been checked into is now
   * past its release deadline — as judged by the real rule, not a mock.
   */
  it("crosses the auto-release deadline when advanced by the grace window", () => {
    const slotStart = new Date("2026-09-03T03:30:00.000Z"); // 09:00 IST
    const autoReleaseMinutes = 120;
    const deadline = new Date(slotStart.getTime() + autoReleaseMinutes * 60_000);

    const atSlotStart = new DemoClock(0, new FixedClock(slotStart));
    expect(atSlotStart.now() >= deadline).toBe(false);

    const advanced = new DemoClock(autoReleaseMinutes * 60, new FixedClock(slotStart));
    expect(advanced.now() >= deadline).toBe(true);
  });
});
