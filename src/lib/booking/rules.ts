/**
 * The time rules, as pure functions.
 *
 * All of them take "now" rather than reading it, both because of the clock rule
 * and because edge case 6 — the cut-off passing while somebody has the edit
 * modal open — is only testable if "now" can be moved between the read and the
 * write.
 */
import { formatInTimeZone } from "date-fns-tz";

import { BookingError } from "@/lib/booking/errors";
import { bookableDates, isBookableDate } from "@/lib/booking-days";
import { findSlot, type SlotDefinition } from "@/lib/slots";
import type { AppSettings } from "@/lib/settings";

/** The instant after which a booking may no longer be changed or cancelled. */
export function cutoffInstant(startsAt: Date, cutoffMinutes: number): Date {
  return new Date(startsAt.getTime() - cutoffMinutes * 60_000);
}

/** The instant an un-checked-in booking becomes eligible for release. */
export function autoReleaseInstant(startsAt: Date, autoReleaseMinutes: number): Date {
  return new Date(startsAt.getTime() + autoReleaseMinutes * 60_000);
}

/** The earliest a booking may be checked into. */
export function checkInOpensAt(startsAt: Date, opensMinutesBefore: number): Date {
  return new Date(startsAt.getTime() - opensMinutesBefore * 60_000);
}

export function isPastCutoff(now: Date, startsAt: Date, cutoffMinutes: number): boolean {
  return now.getTime() >= cutoffInstant(startsAt, cutoffMinutes).getTime();
}

/**
 * Refuses a late change, and says exactly when the door closed.
 *
 * "Too late" on its own is the kind of message that generates a support
 * request. The cut-off is a settings value nobody has memorised, so the error
 * states the instant and the rule that produced it.
 */
export function assertBeforeCutoff(
  now: Date,
  startsAt: Date,
  cutoffMinutes: number,
  timezone: string,
): void {
  if (!isPastCutoff(now, startsAt, cutoffMinutes)) return;
  const cutoff = cutoffInstant(startsAt, cutoffMinutes);
  const cutoffLabel = formatInTimeZone(cutoff, timezone, "HH:mm 'on' EEEE d MMMM");
  const startLabel = formatInTimeZone(startsAt, timezone, "HH:mm");
  throw new BookingError(
    "PAST_CUTOFF",
    `Changes closed at ${cutoffLabel} — ${cutoffMinutes} minutes before the ${startLabel} start.`,
    { cutoffAt: cutoff.toISOString(), startsAt: startsAt.toISOString(), cutoffMinutes },
  );
}

/** Resolves a slot key against the live definitions, or refuses it by name. */
export function requireSlot(settings: AppSettings, key: string): SlotDefinition {
  const slot = findSlot(settings.slotDefinitions, key);
  if (!slot) {
    throw new BookingError(
      "UNKNOWN_SLOT",
      `"${key}" is not a bookable slot. Available: ${settings.slotDefinitions
        .map((d) => d.key)
        .join(", ")}.`,
    );
  }
  return slot;
}

/**
 * The window the strip offers is the window the server enforces.
 *
 * Before this existed the date strip was a suggestion and a hand-edited URL
 * could book any date at all, including one in the past, which would then be
 * counted by the analytics as a desk somebody held.
 */
export function assertDateBookable(
  date: string,
  now: Date,
  settings: AppSettings,
  holidays: ReadonlySet<string>,
): void {
  const options = {
    now,
    workingDays: settings.bookingWindowWorkingDays,
    calendarBound: settings.bookingWindowDays,
    holidays,
    timezone: settings.timezone,
  };
  if (isBookableDate(date, options)) return;

  const offered = bookableDates(options);
  throw new BookingError(
    "DATE_OUTSIDE_WINDOW",
    offered.length === 0
      ? "There are no bookable days in the current window."
      : `${date} is not bookable. Desks may be booked for the next ${settings.bookingWindowWorkingDays} working days: ${offered[0]} to ${offered[offered.length - 1]}.`,
    { offered },
  );
}
