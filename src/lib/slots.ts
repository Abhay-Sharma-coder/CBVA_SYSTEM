/**
 * Slots are a LIST, not an enum.
 *
 * CBVA's document says "hourly booking"; the only worked example in it is a
 * half-day window, and the deck we showed them uses half days. So half days are
 * what ships — but as data, in `settings.slot_definitions`, not as a type.
 * Switching the firm to hourly booking is then one settings write and a
 * backfill, which is why `bookings.slot` is text (ADR-020) and why every
 * consumer takes the definitions as an argument instead of importing a
 * constant.
 *
 * This file is also the ONLY place `bookings.starts_at` / `ends_at` are
 * computed. See ADR-007, closed by ADR-021.
 */
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";

import { APP_TIMEZONE } from "@/lib/config";

export interface SlotDefinition {
  /** Stored in `bookings.slot`. Short, stable, printable. */
  key: string;
  label: string;
  /** "HH:mm" in the office's local wall-clock time. */
  start: string;
  /** "HH:mm". Exclusive: a slot ending 13:00 abuts one starting 13:00. */
  end: string;
}

/**
 * The seeded configuration, from the brief: half days, 09:00–13:00 and
 * 13:00–17:00. Provisional until CBVA confirms — see ASSUMPTIONS A4.
 */
export const DEFAULT_SLOT_DEFINITIONS: readonly SlotDefinition[] = [
  { key: "AM", label: "Morning", start: "09:00", end: "13:00" },
  { key: "PM", label: "Afternoon", start: "13:00", end: "17:00" },
] as const;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:mm" -> minutes past midnight. The only place that parse happens. */
export function minutesOfDay(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Not a HH:mm time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

const oneDefinition = z.object({
  key: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9_-]+$/, "A slot key may only contain letters, digits, _ and -"),
  label: z.string().min(1).max(40),
  start: z.string().regex(TIME_RE, "start must be HH:mm"),
  end: z.string().regex(TIME_RE, "end must be HH:mm"),
});

/**
 * Accepts the array shape and the legacy `{ AM: {...}, PM: {...} }` record the
 * Phase 1 seed wrote, normalising both to an ordered array.
 *
 * Tolerating the old shape is not politeness: a database seeded before this
 * phase would otherwise fail to render the date strip, and the first symptom
 * would be an empty screen rather than a migration error.
 */
export const slotDefinitionsSchema = z
  .union([
    z.array(oneDefinition).min(1),
    z.record(z.string(), oneDefinition.omit({ key: true })),
  ])
  .transform((value): SlotDefinition[] =>
    Array.isArray(value)
      ? value
      : Object.entries(value).map(([key, def]) => ({ key, ...def })),
  )
  .superRefine((defs, ctx) => {
    const seen = new Set<string>();
    for (const d of defs) {
      if (seen.has(d.key)) {
        ctx.addIssue({ code: "custom", message: `Duplicate slot key "${d.key}"` });
      }
      seen.add(d.key);
      if (minutesOfDay(d.end) <= minutesOfDay(d.start)) {
        ctx.addIssue({
          code: "custom",
          message: `Slot "${d.key}" ends at or before it starts (${d.start}–${d.end})`,
        });
      }
    }
    // Overlap is checked rather than assumed: two slots covering the same hour
    // would let one person hold two desks for the same real time while both
    // partial unique indexes stayed happy, because the keys differ.
    const sorted = [...defs].sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start));
    for (let i = 1; i < sorted.length; i += 1) {
      if (minutesOfDay(sorted[i]!.start) < minutesOfDay(sorted[i - 1]!.end)) {
        ctx.addIssue({
          code: "custom",
          message: `Slots "${sorted[i - 1]!.key}" and "${sorted[i]!.key}" overlap`,
        });
      }
    }
  })
  .transform((defs) => [...defs].sort((a, b) => minutesOfDay(a.start) - minutesOfDay(b.start)));

/** Parses `settings.slot_definitions`, falling back to the defaults if unset. */
export function parseSlotDefinitions(value: unknown): SlotDefinition[] {
  if (value === null || value === undefined) return [...DEFAULT_SLOT_DEFINITIONS];
  return slotDefinitionsSchema.parse(value);
}

export function findSlot(
  definitions: readonly SlotDefinition[],
  key: string,
): SlotDefinition | null {
  return definitions.find((d) => d.key === key) ?? null;
}

/**
 * The single place bookings.starts_at / ends_at are computed.
 *
 * Stored rather than derived on read so the auto-release job can range-scan a
 * timestamptz index (ADR-007). That makes them stale the moment a slot boundary
 * is edited, which is why editing `slot_definitions` backfills them in the same
 * transaction (ADR-021). Do not add a second copy of this function.
 *
 * @param bookingDate ISO date, "yyyy-MM-dd", no time component.
 */
export function deriveSlotBounds(
  bookingDate: string,
  slot: string,
  definitions: readonly SlotDefinition[] = DEFAULT_SLOT_DEFINITIONS,
  timezone: string = APP_TIMEZONE,
): { startsAt: Date; endsAt: Date } {
  const def = findSlot(definitions, slot);
  if (!def) {
    throw new Error(
      `Unknown slot "${slot}". Known slots: ${definitions.map((d) => d.key).join(", ")}`,
    );
  }
  return {
    startsAt: fromZonedTime(`${bookingDate}T${def.start}:00`, timezone),
    endsAt: fromZonedTime(`${bookingDate}T${def.end}:00`, timezone),
  };
}

/**
 * Hourly slots, for the day CBVA asks for them — and for the test that proves
 * the switch is a settings change rather than a refactor.
 */
export function hourlySlotDefinitions(startHour = 9, endHour = 17): SlotDefinition[] {
  const out: SlotDefinition[] = [];
  for (let h = startHour; h < endHour; h += 1) {
    const hh = String(h).padStart(2, "0");
    const nn = String(h + 1).padStart(2, "0");
    out.push({ key: `H${hh}`, label: `${hh}:00`, start: `${hh}:00`, end: `${nn}:00` });
  }
  return out;
}
