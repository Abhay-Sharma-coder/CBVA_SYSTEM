/**
 * Which days the floor plan may show.
 *
 * Pure and clock-injected, so it is unit-testable and so the demo clock moves
 * the date strip along with everything else. Never reads the system clock.
 */
import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import type { BookableDay } from "@/components/floor-plan/types";
import { APP_TIMEZONE } from "@/lib/config";

/**
 * Saturday and Sunday. The firm does not book desks at the weekend.
 *
 * The weekday of a "yyyy-MM-dd" is a calendar fact, so it is read in UTC. Doing
 * it in the server's local zone would slip a day whenever the server is not in
 * Asia/Kolkata, which in practice it never is.
 */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export interface BookingDayOptions {
  /** "Now", from the Clock — never from the system. */
  now: Date;
  /** settings.booking_window_days. Not hardcoded anywhere. */
  windowDays: number;
  /** yyyy-MM-dd rows from the holidays table. */
  holidays: ReadonlySet<string>;
  /** How many to show in the strip. */
  limit?: number;
  timezone?: string;
}

/**
 * Today plus the next working days, skipping weekends and holidays, bounded by
 * the booking window from settings.
 */
export function bookableDays({
  now,
  windowDays,
  holidays,
  limit = 6,
  timezone = APP_TIMEZONE,
}: BookingDayOptions): BookableDay[] {
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const out: BookableDay[] = [];

  for (let offset = 0; offset <= windowDays && out.length < limit; offset += 1) {
    const date = formatInTimeZone(addDays(now, offset), timezone, "yyyy-MM-dd");
    if (isWeekend(date) || holidays.has(date)) continue;
    out.push({
      date,
      weekdayLabel: formatInTimeZone(`${date}T00:00:00Z`, "UTC", "EEE"),
      dayLabel: formatInTimeZone(`${date}T00:00:00Z`, "UTC", "d"),
      monthLabel: formatInTimeZone(`${date}T00:00:00Z`, "UTC", "MMM"),
      isToday: date === today,
    });
  }

  return out;
}
