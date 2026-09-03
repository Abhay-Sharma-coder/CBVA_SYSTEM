/**
 * Editing settings — and the backfill that ADR-007 said Phase 3 owed.
 *
 * THE PROBLEM ADR-007 LEFT OPEN. `bookings.starts_at` and `ends_at` are derived
 * from `booking_date + slot + settings.slot_definitions` AT WRITE TIME, and
 * stored, because the auto-release job needs to range-scan a timestamptz index
 * rather than re-derive a timezone conversion per row. The cost is that the
 * moment somebody edits a slot boundary, every historical row silently
 * disagrees with the settings that supposedly define it — and since analytics
 * is the product, silently wrong history is the worst failure available.
 *
 * THE FIX. Editing `slot_definitions` backfills every affected booking IN THE
 * SAME TRANSACTION. Either the definitions and the rows both move, or neither
 * does. And if the new definitions drop a slot key some booking still uses, the
 * change is REFUSED with that list rather than leaving orphans behind — there
 * is no correct start time to give a booking whose slot no longer exists.
 */
import { eq, inArray, sql } from "drizzle-orm";

import { writeAudit } from "@/lib/audit";
import { BookingError } from "@/lib/booking/errors";
import type { Clock } from "@/lib/clock";
import { schema, type Db } from "@/lib/db";
import type { User } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { deriveSlotBounds, slotDefinitionsSchema, type SlotDefinition } from "@/lib/slots";

/** Booking states whose stored bounds still matter. Terminal rows are history. */
const LIVE_STATUSES = ["confirmed", "checked_in"] as const;

export interface UpdateSettingsInput {
  slotDefinitions?: unknown;
  bookingWindowDays?: number;
  bookingWindowWorkingDays?: number;
  cutoffMinutes?: number;
  autoReleaseMinutes?: number;
  checkInOpensMinutesBefore?: number;
  officeHours?: { start: string; end: string };
  /** Also rewrite the bounds of finished bookings. Off by default. */
  backfillHistory?: boolean;
}

export interface UpdateSettingsResult {
  backfilled: number;
  slotDefinitions: SlotDefinition[];
}

export async function updateSettings(
  ctx: { db: Db; clock: Clock; actor: User },
  input: UpdateSettingsInput,
): Promise<UpdateSettingsResult> {
  const before = await getSettings(ctx.db);

  const nextDefinitions = input.slotDefinitions
    ? slotDefinitionsSchema.parse(input.slotDefinitions)
    : before.slotDefinitions;

  return ctx.db.transaction(async (tx) => {
    if (input.slotDefinitions) {
      const keys = new Set(nextDefinitions.map((d) => d.key));
      const statuses = input.backfillHistory
        ? undefined
        : ([...LIVE_STATUSES] as unknown as string[]);

      const orphanRows = await tx
        .select({
          slot: schema.bookings.slot,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.bookings)
        .where(
          statuses
            ? inArray(schema.bookings.status, statuses as ("confirmed" | "checked_in")[])
            : sql`true`,
        )
        .groupBy(schema.bookings.slot);

      const orphans = orphanRows.filter((r) => !keys.has(r.slot));
      if (orphans.length > 0) {
        throw new BookingError(
          "UNKNOWN_SLOT",
          `Those slot definitions drop ${orphans
            .map((o) => `"${o.slot}" (${o.n} booking${o.n === 1 ? "" : "s"})`)
            .join(", ")}. Cancel or move them first — a booking whose slot no longer exists has no start time.`,
          { orphans },
        );
      }
    }

    await tx
      .update(schema.settings)
      .set({
        slotDefinitions: nextDefinitions,
        bookingWindowDays: input.bookingWindowDays ?? before.bookingWindowDays,
        bookingWindowWorkingDays:
          input.bookingWindowWorkingDays ?? before.bookingWindowWorkingDays,
        cutoffMinutes: input.cutoffMinutes ?? before.cutoffMinutes,
        autoReleaseMinutes: input.autoReleaseMinutes ?? before.autoReleaseMinutes,
        checkInOpensMinutesBefore:
          input.checkInOpensMinutesBefore ?? before.checkInOpensMinutesBefore,
        officeHours: input.officeHours ?? before.officeHours,
      })
      .where(eq(schema.settings.id, before.id));

    let backfilled = 0;
    if (input.slotDefinitions) {
      backfilled = await backfillSlotBounds(tx, nextDefinitions, before.timezone, {
        includeHistory: input.backfillHistory ?? false,
        now: ctx.clock.now(),
      });
    }

    await writeAudit(tx, {
      actorUserId: ctx.actor.id,
      entity: "settings",
      entityId: before.id,
      action: "update_settings",
      before: {
        slotDefinitions: before.slotDefinitions,
        cutoffMinutes: before.cutoffMinutes,
        autoReleaseMinutes: before.autoReleaseMinutes,
        bookingWindowWorkingDays: before.bookingWindowWorkingDays,
        officeHours: before.officeHours,
      },
      after: {
        slotDefinitions: nextDefinitions,
        cutoffMinutes: input.cutoffMinutes ?? before.cutoffMinutes,
        autoReleaseMinutes: input.autoReleaseMinutes ?? before.autoReleaseMinutes,
        bookingWindowWorkingDays:
          input.bookingWindowWorkingDays ?? before.bookingWindowWorkingDays,
        officeHours: input.officeHours ?? before.officeHours,
        backfilled,
      },
    });

    return { backfilled, slotDefinitions: nextDefinitions };
  });
}

/**
 * Recomputes stored bounds from the definitions now in force.
 *
 * Exported so `scripts/backfill-slot-bounds.ts` can run the identical
 * computation from the command line — there is still exactly one derivation
 * (`deriveSlotBounds`), which is what ADR-007 asked for.
 */
export async function backfillSlotBounds(
  db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0],
  definitions: SlotDefinition[],
  timezone: string,
  options: { includeHistory: boolean; now: Date },
): Promise<number> {
  const rows = await db
    .select({
      id: schema.bookings.id,
      bookingDate: schema.bookings.bookingDate,
      slot: schema.bookings.slot,
      startsAt: schema.bookings.startsAt,
      endsAt: schema.bookings.endsAt,
    })
    .from(schema.bookings)
    .where(
      options.includeHistory
        ? sql`true`
        : inArray(schema.bookings.status, [...LIVE_STATUSES]),
    );

  let changed = 0;
  for (const row of rows) {
    const definition = definitions.find((d) => d.key === row.slot);
    if (!definition) continue;
    const { startsAt, endsAt } = deriveSlotBounds(row.bookingDate, row.slot, definitions, timezone);
    if (startsAt.getTime() === row.startsAt.getTime() && endsAt.getTime() === row.endsAt.getTime()) {
      continue;
    }
    await db
      .update(schema.bookings)
      .set({ startsAt, endsAt, updatedAt: options.now })
      .where(eq(schema.bookings.id, row.id));
    changed += 1;
  }
  return changed;
}
