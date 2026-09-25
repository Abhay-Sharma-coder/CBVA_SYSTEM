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
import { schema, type Db, type DbLike } from "@/lib/db";
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
  timezone?: string;
  /** Blast-radius bounds on the auto-release job (ASSUMPTIONS A22). */
  autoReleaseBatchCap?: number;
  autoReleaseHorizonDays?: number;
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

      /**
       * Two more tables carry slot keys since Phase 5, and neither was in this
       * check. A recurring series or a released desk pointing at a slot that no
       * longer exists is the same orphan a booking would be — the series would
       * fail on every tick, and the release would silently stop widening
       * capacity — so both are refused here rather than discovered later.
       */
      const seriesSlots = await tx
        .selectDistinct({ slot: schema.bookingSeries.slot })
        .from(schema.bookingSeries)
        .where(sql`${schema.bookingSeries.status} <> 'ended'`);
      const releaseSlots = await tx
        .selectDistinct({ slot: schema.seatReleases.slot })
        .from(schema.seatReleases)
        .where(sql`${schema.seatReleases.revokedAt} is null`);

      const extra = [...seriesSlots, ...releaseSlots]
        .filter((r) => !keys.has(r.slot))
        .map((r) => ({ slot: r.slot, n: 0 }));

      const orphans = [...orphanRows.filter((r) => !keys.has(r.slot)), ...extra];
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
        timezone: input.timezone ?? before.timezone,
        autoReleaseBatchCap: input.autoReleaseBatchCap ?? before.autoReleaseBatchCap,
        autoReleaseHorizonDays:
          input.autoReleaseHorizonDays ?? before.autoReleaseHorizonDays,
      })
      .where(eq(schema.settings.id, before.id));

    let backfilled = 0;
    // A timezone change moves every derived bound just as surely as a slot
    // change does — 09:00 in Kolkata is not 09:00 in Dubai — so it triggers the
    // same backfill. Missing this would leave every live booking pointing at
    // the wrong instant with nothing on screen to say so.
    if (input.slotDefinitions || (input.timezone && input.timezone !== before.timezone)) {
      const timezone = input.timezone ?? before.timezone;
      backfilled = await backfillSlotBounds(tx, nextDefinitions, timezone, {
        includeHistory: input.backfillHistory ?? false,
        now: ctx.clock.now(),
      });
      backfilled += await backfillReleaseBounds(tx, nextDefinitions, timezone, ctx.clock.now());
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

/**
 * The same backfill, for `seat_releases`.
 *
 * A release stores derived `starts_at`/`ends_at` for exactly the reason a
 * booking does, so it drifts for exactly the same reason when a slot boundary
 * or the timezone moves. ADR-021 made the booking backfill the thing that keeps
 * derived bounds honest; leaving a second table out of it would reopen the
 * problem that ADR closed, one table over.
 *
 * Only live, future releases are touched. A revoked one is history.
 */
export async function backfillReleaseBounds(
  db: DbLike,
  definitions: SlotDefinition[],
  timezone: string,
  now: Date,
): Promise<number> {
  const rows = await (db as Db)
    .select({
      id: schema.seatReleases.id,
      releaseDate: schema.seatReleases.releaseDate,
      slot: schema.seatReleases.slot,
      startsAt: schema.seatReleases.startsAt,
      endsAt: schema.seatReleases.endsAt,
    })
    .from(schema.seatReleases)
    .where(sql`${schema.seatReleases.revokedAt} is null`);

  let changed = 0;
  for (const row of rows) {
    if (!definitions.some((d) => d.key === row.slot)) continue;
    const { startsAt, endsAt } = deriveSlotBounds(
      row.releaseDate,
      row.slot,
      definitions,
      timezone,
    );
    if (
      startsAt.getTime() === row.startsAt.getTime() &&
      endsAt.getTime() === row.endsAt.getTime()
    ) {
      continue;
    }
    await (db as Db)
      .update(schema.seatReleases)
      .set({ startsAt, endsAt, updatedAt: now })
      .where(eq(schema.seatReleases.id, row.id));
    changed += 1;
  }
  return changed;
}
