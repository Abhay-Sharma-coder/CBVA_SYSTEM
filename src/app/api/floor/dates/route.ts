import { NextResponse } from "next/server";

import { bookableDays } from "@/lib/booking-days";
import { getClock } from "@/lib/clock";
import { APP_TIMEZONE } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { DEFAULT_SLOT_DEFINITIONS } from "@/lib/slots";
import type { SlotDefinition, SlotKey } from "@/components/floor-plan/types";

export const dynamic = "force-dynamic";

/**
 * The date strip and the slot definitions behind it.
 *
 * Both come from `settings` rather than from constants: booking_window_days
 * bounds how far ahead the strip runs, and slot_definitions supplies the AM/PM
 * labels and times. "Today" comes from the Clock, so advancing the demo clock
 * past midnight moves the strip along with it.
 */
export async function GET() {
  const clock = await getClock();
  const database = db();

  const [settings] = await database.select().from(schema.settings).limit(1);
  const holidayRows = await database
    .select({ holidayDate: schema.holidays.holidayDate })
    .from(schema.holidays);

  const definitions = (settings?.slotDefinitions ??
    DEFAULT_SLOT_DEFINITIONS) as typeof DEFAULT_SLOT_DEFINITIONS;

  const slots: SlotDefinition[] = (["AM", "PM"] as SlotKey[]).map((key) => ({
    key,
    label: definitions[key]?.label ?? key,
    start: definitions[key]?.start ?? "",
    end: definitions[key]?.end ?? "",
  }));

  return NextResponse.json({
    timezone: settings?.timezone ?? APP_TIMEZONE,
    bookingWindowDays: settings?.bookingWindowDays ?? 14,
    days: bookableDays({
      now: clock.now(),
      windowDays: settings?.bookingWindowDays ?? 14,
      // `date` columns come back from pg as strings, deliberately.
      holidays: new Set(holidayRows.map((h) => h.holidayDate)),
      timezone: settings?.timezone ?? APP_TIMEZONE,
    }),
    slots,
  });
}
