/**
 * The settings singleton, read once and parsed properly.
 *
 * Before this, four call sites did `select().from(settings).limit(1)` inline
 * and each carried its own `?? 14` fallback, so a missing settings row produced
 * four different opinions about the booking window. There is one row; there
 * should be one reader.
 *
 * `slot_definitions` and `office_hours` are jsonb, which means the database
 * will store anything. They are parsed through zod here so a hand-edited
 * settings row fails loudly at the boundary instead of producing bookings with
 * a NaN start time.
 */
import { z } from "zod";

import { db as defaultDb, schema, type Db } from "@/lib/db";
import { APP_TIMEZONE } from "@/lib/config";
import {
  DEFAULT_SLOT_DEFINITIONS,
  minutesOfDay,
  parseSlotDefinitions,
  type SlotDefinition,
} from "@/lib/slots";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const officeHoursSchema = z
  .object({
    start: z.string().regex(TIME_RE, "office hours start must be HH:mm"),
    end: z.string().regex(TIME_RE, "office hours end must be HH:mm"),
  })
  .refine((v) => minutesOfDay(v.end) > minutesOfDay(v.start), {
    message: "Office hours must end after they start",
  });

export type OfficeHours = z.infer<typeof officeHoursSchema>;

export const DEFAULT_OFFICE_HOURS: OfficeHours = { start: "08:00", end: "20:00" };

export interface AppSettings {
  id: string;
  timezone: string;
  /** Calendar-day bound the working-day scan stops at. */
  bookingWindowDays: number;
  /** The rule: this many WORKING days ahead are bookable. */
  bookingWindowWorkingDays: number;
  /** Minutes before slot start after which edit and cancel are closed. */
  cutoffMinutes: number;
  /** Minutes after slot start with no check-in before the desk is released. */
  autoReleaseMinutes: number;
  /** How early a booking may be checked into, relative to its slot start. */
  checkInOpensMinutesBefore: number;
  slotDefinitions: SlotDefinition[];
  officeHours: OfficeHours;
  demoOffsetSeconds: number;
}

export async function getSettings(database: Db = defaultDb()): Promise<AppSettings> {
  const [row] = await database.select().from(schema.settings).limit(1);
  if (!row) {
    throw new Error("settings row missing — run `npm run seed`");
  }
  return {
    id: row.id,
    timezone: row.timezone ?? APP_TIMEZONE,
    bookingWindowDays: row.bookingWindowDays,
    bookingWindowWorkingDays: row.bookingWindowWorkingDays,
    cutoffMinutes: row.cutoffMinutes,
    autoReleaseMinutes: row.autoReleaseMinutes,
    checkInOpensMinutesBefore: row.checkInOpensMinutesBefore,
    slotDefinitions: parseSlotDefinitions(row.slotDefinitions),
    officeHours: officeHoursSchema.parse(row.officeHours ?? DEFAULT_OFFICE_HOURS),
    demoOffsetSeconds: row.demoOffsetSeconds,
  };
}

/**
 * The shape the seed writes and the settings editor validates against.
 * Exported so both use the same definition of "valid".
 */
export const SEEDED_SLOT_DEFINITIONS: SlotDefinition[] = [...DEFAULT_SLOT_DEFINITIONS];
