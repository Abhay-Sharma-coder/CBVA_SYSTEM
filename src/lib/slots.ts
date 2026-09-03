import { fromZonedTime } from "date-fns-tz";
import { APP_TIMEZONE } from "@/lib/config";
import type { Slot } from "@/lib/db/schema";

/**
 * Slot boundaries, in the office's local wall-clock time.
 *
 * PROVISIONAL — see docs/ASSUMPTIONS.md. CBVA has not confirmed the half-day
 * split. These mirror the defaults written into settings.slot_definitions by
 * the seed; settings is the runtime source of truth once an admin edits it.
 */
export const DEFAULT_SLOT_DEFINITIONS: Record<
  Slot,
  { label: string; start: string; end: string }
> = {
  AM: { label: "Morning", start: "09:00", end: "13:30" },
  PM: { label: "Afternoon", start: "13:30", end: "19:00" },
};

export type SlotDefinitions = typeof DEFAULT_SLOT_DEFINITIONS;

/**
 * The single place bookings.starts_at / ends_at are computed.
 *
 * bookings stores these as derived columns so the auto-release job can range
 * scan without re-deriving. That makes them stale if slot boundaries are ever
 * edited — see ADR-007 in docs/DECISIONS.md; the fix is a backfill migration,
 * not a second copy of this function.
 *
 * @param bookingDate ISO date, "yyyy-MM-dd", no time component.
 */
export function deriveSlotBounds(
  bookingDate: string,
  slot: Slot,
  definitions: SlotDefinitions = DEFAULT_SLOT_DEFINITIONS,
  timezone: string = APP_TIMEZONE,
): { startsAt: Date; endsAt: Date } {
  const def = definitions[slot];
  return {
    startsAt: fromZonedTime(`${bookingDate}T${def.start}:00`, timezone),
    endsAt: fromZonedTime(`${bookingDate}T${def.end}:00`, timezone),
  };
}
