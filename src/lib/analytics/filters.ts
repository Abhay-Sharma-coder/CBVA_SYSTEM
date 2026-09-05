/**
 * The one filter parser.
 *
 * Every analytics route and every export reads its filters through this, so a
 * CSV can never disagree with the chart it was downloaded from — "respect the
 * active filters" is a property of there being a single parser rather than a
 * rule three route handlers have to remember.
 */
import { z } from "zod";

import type { AnalyticsFilters } from "./queries";
import { MEASURE_KEYS, type MeasureKey } from "./measures";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dates must be yyyy-MM-dd");

export const filterSchema = z.object({
  from: DATE,
  to: DATE,
  zone: z.string().max(4).nullable().optional(),
  bay: z.string().max(12).nullable().optional(),
  team: z.string().max(80).nullable().optional(),
  // Not an enum: the slot vocabulary is settings data (ADR-020).
  slot: z.string().max(12).nullable().optional(),
  measure: z.enum(MEASURE_KEYS).nullable().optional(),
});

export interface ParsedFilters extends AnalyticsFilters {
  measure: MeasureKey;
}

/** How far back the trends screen looks by default. */
export const DEFAULT_TREND_DAYS = 56;

export function parseFilters(url: URL, today: string): ParsedFilters {
  const q = url.searchParams;
  const raw = {
    from: q.get("from") ?? shiftDays(today, -DEFAULT_TREND_DAYS),
    to: q.get("to") ?? today,
    zone: q.get("zone"),
    bay: q.get("bay"),
    team: q.get("team"),
    slot: q.get("slot"),
    measure: q.get("measure"),
  };

  const parsed = filterSchema.parse(raw);

  // A reversed range is a typo in a URL somebody hand-edited, not an attack.
  // Swapping is friendlier than a 422 and cannot produce a wrong number.
  const [from, to] = parsed.from <= parsed.to ? [parsed.from, parsed.to] : [parsed.to, parsed.from];

  return {
    from,
    to,
    zone: parsed.zone || null,
    bay: parsed.bay || null,
    team: parsed.team || null,
    slot: parsed.slot || null,
    measure: (parsed.measure as MeasureKey | null) ?? "booked",
  };
}

export function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Working days between two dates inclusive, ignoring holidays. */
export function workingDaysBetween(from: string, to: string): number {
  let n = 0;
  let cursor = from;
  while (cursor <= to && n < 3000) {
    const [y, m, d] = cursor.split("-").map(Number);
    const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
    cursor = shiftDays(cursor, 1);
  }
  return n;
}

/** The filter values that are actually set, for an export filename. */
export function filterParts(f: ParsedFilters): Record<string, string | null | undefined> {
  return { zone: f.zone, bay: f.bay, team: f.team, slot: f.slot };
}
