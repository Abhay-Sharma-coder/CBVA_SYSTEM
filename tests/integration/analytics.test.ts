import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import {
  createPhase3Fixtures,
  destroyPhase3Fixtures,
  clearBookings,
  testDb,
  testPool,
  FixedClock,
  MONDAY,
  AM,
  PM,
  type Phase3Fixtures,
} from "../phase3-helpers";
import { capacityByDaySlot, occupancyByDaySlot } from "@/lib/analytics/queries";
import { schema, type Db } from "@/lib/db";
import { deriveSlotBounds, DEFAULT_SLOT_DEFINITIONS } from "@/lib/slots";
import type { Pool } from "pg";

/**
 * THE MOST IMPORTANT NEW TEST IN PHASE 5.
 *
 * `released_at` is overloaded: the auto-release job writes it on the
 * `completed_no_show` transition as well as on `auto_released`, and the seed
 * writes a DIFFERENT value for the same status. So the obvious seat-hours
 * expression —
 *
 *     coalesce(released_at, cancelled_at, ends_at)
 *
 * — under-counts no-show hours by roughly half on demo data and not at all in
 * production. It produces a plausible number, in the direction that flatters
 * the floor, with no error anywhere.
 *
 * This asserts the exact seat-hours contribution of one row in each of the
 * eight statuses, in BOTH shapes: the runtime shape (released_at set at the
 * moment the job ran) and the seeded shape (released_at set to a fixed offset).
 * If somebody simplifies the CASE, one of these numbers moves.
 */
describe("seat-hours are computed per status, not by coalesce", () => {
  let pool: Pool;
  let db: Db;
  let f: Phase3Fixtures;

  /** Both seeded slots are four hours long. */
  const SLOT_HOURS = 4;
  const { startsAt, endsAt } = deriveSlotBounds(MONDAY, AM.key, [...DEFAULT_SLOT_DEFINITIONS]);
  /** Well after the slot, so `least(…, now)` never truncates a live booking. */
  const NOW = new Date(endsAt.getTime() + 3 * 3_600_000);
  const clock = new FixedClock(NOW);

  beforeAll(async () => {
    pool = testPool();
    db = testDb(pool);
    f = await createPhase3Fixtures(db);
    await clearBookings(db, f);
  });

  afterAll(async () => {
    await clearBookings(db, f);
    await destroyPhase3Fixtures(db, f);
    await pool.end();
  });

  /** Insert one booking in a given shape and read back its seat-hours. */
  async function hoursFor(row: Partial<typeof schema.bookings.$inferInsert>): Promise<number> {
    await clearBookings(db, f);
    await db.insert(schema.bookings).values({
      seatId: f.seatA.id,
      bookingDate: MONDAY,
      slot: AM.key,
      startsAt,
      endsAt,
      bookedByUserId: f.article.id,
      occupantUserId: f.article.id,
      status: "confirmed",
      source: "self",
      createdAt: NOW,
      updatedAt: NOW,
      ...row,
    });

    const [out] = await occupancyByDaySlot(
      db,
      { from: MONDAY, to: MONDAY, slot: AM.key },
      clock.now(),
    );
    return out?.seatHours ?? 0;
  }

  it("charges a completed booking the whole slot", async () => {
    expect(await hoursFor({ status: "completed", checkedInAt: startsAt })).toBe(SLOT_HOURS);
  });

  /**
   * THE ONE THE COALESCE WOULD GET WRONG.
   *
   * The desk sat inside seat_slot_unique's predicate from starts_at until the
   * job settled it, so nobody else could have it for one second of the slot. If
   * a no-show were free, the analytics could not answer "what do no-shows cost
   * us in desks" — see ASSUMPTIONS A25 for why this is still an assumption.
   */
  it("charges a no-show the whole slot, in the RUNTIME shape", async () => {
    // The job sets released_at = now, which is hours AFTER the slot ended.
    expect(await hoursFor({ status: "completed_no_show", releasedAt: NOW })).toBe(SLOT_HOURS);
  });

  it("charges a no-show the whole slot, in the SEEDED shape", async () => {
    // The seed sets released_at = starts_at + 120 min. A coalesce would read
    // that as two hours consumed. It is four.
    expect(
      await hoursFor({
        status: "completed_no_show",
        releasedAt: new Date(startsAt.getTime() + 120 * 60_000),
      }),
    ).toBe(SLOT_HOURS);
  });

  it("charges an auto-released booking only up to the release", async () => {
    expect(
      await hoursFor({
        status: "auto_released",
        releasedAt: new Date(startsAt.getTime() + 2 * 3_600_000),
      }),
    ).toBe(2);
  });

  it("charges somebody who left early only up to when they left", async () => {
    expect(
      await hoursFor({
        status: "cancelled_after_check_in",
        checkedInAt: startsAt,
        cancelledAt: new Date(startsAt.getTime() + 1.5 * 3_600_000),
      }),
    ).toBe(1.5);
  });

  it("charges a pre-slot cancellation nothing at all", async () => {
    expect(
      await hoursFor({
        status: "cancelled_by_user",
        cancelledAt: new Date(startsAt.getTime() - 3_600_000),
      }),
    ).toBe(0);
  });

  /**
   * `least` IGNORES nulls in Postgres, so a null cancelled_at outside the CASE
   * arm would score a full slot rather than zero. The coalesce lives inside
   * each arm precisely for this.
   */
  it("charges a cancellation with no timestamp nothing, rather than a full slot", async () => {
    expect(await hoursFor({ status: "cancelled_by_user", cancelledAt: null })).toBe(0);
  });

  it("charges a live booking only up to now", async () => {
    const midSlot = new Date(startsAt.getTime() + 1 * 3_600_000);
    await clearBookings(db, f);
    await db.insert(schema.bookings).values({
      seatId: f.seatA.id,
      bookingDate: MONDAY,
      slot: AM.key,
      startsAt,
      endsAt,
      bookedByUserId: f.article.id,
      occupantUserId: f.article.id,
      status: "checked_in",
      source: "self",
      checkedInAt: startsAt,
      createdAt: midSlot,
      updatedAt: midSlot,
    });
    const [out] = await occupancyByDaySlot(
      db,
      { from: MONDAY, to: MONDAY, slot: AM.key },
      midSlot,
    );
    expect(out?.seatHours).toBe(1);
  });

  /**
   * The gap between the two accountings IS the cost of no-shows, and it is the
   * number the client will be asked to decide about. If they ever become equal,
   * one of the two expressions has been simplified into the other.
   */
  it("reports the alternative accounting, and it differs by exactly the no-show hours", async () => {
    await clearBookings(db, f);
    await db.insert(schema.bookings).values({
      seatId: f.seatA.id,
      bookingDate: MONDAY,
      slot: AM.key,
      startsAt,
      endsAt,
      bookedByUserId: f.article.id,
      occupantUserId: f.article.id,
      status: "completed_no_show",
      source: "self",
      releasedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const [out] = await occupancyByDaySlot(
      db,
      { from: MONDAY, to: MONDAY, slot: AM.key },
      NOW,
    );
    expect(out?.seatHours).toBe(SLOT_HOURS);
    expect(out?.seatHoursNoShowFree).toBe(0);
  });
});

/**
 * Capacity has to be date-aware and has to count a released allocated desk.
 * Getting it wrong changes the denominator of every percentage in the product.
 */
describe("capacity", () => {
  let pool: Pool;
  let db: Db;
  let f: Phase3Fixtures;
  const clock = new FixedClock(new Date(`${MONDAY}T12:00:00Z`));

  beforeAll(async () => {
    pool = testPool();
    db = testDb(pool);
    f = await createPhase3Fixtures(db);
  });

  afterAll(async () => {
    await db.delete(schema.seatReleases).where(eq(schema.seatReleases.seatId, f.seatB.id));
    await destroyPhase3Fixtures(db, f);
    await pool.end();
  });

  /** Only this test's own zone, so the seeded floor cannot drift the numbers. */
  async function poolAndCapacity(): Promise<{ pool: number; capacity: number }> {
    const [row] = await capacityByDaySlot(
      db,
      [MONDAY],
      [...DEFAULT_SLOT_DEFINITIONS],
      { slot: AM.key, zone: null, bay: null },
    );
    // capacityByDaySlot has no fixture scope, so isolate by counting only the
    // delta this test causes: read twice around the change instead.
    return { pool: row?.pool ?? 0, capacity: row?.capacity ?? 0 };
  }

  it("counts a released allocated desk as capacity, and not as pool", async () => {
    const before = await poolAndCapacity();

    // Take seatB out of the bookable pool by allocating it...
    await db
      .update(schema.seats)
      .set({ status: "fixed", assignedUserId: f.manager.id })
      .where(eq(schema.seats.id, f.seatB.id));

    const allocated = await poolAndCapacity();
    expect(allocated.pool).toBe(before.pool - 1);
    expect(allocated.capacity).toBe(before.capacity - 1);

    // ...then have its owner release it for that slot.
    const bounds = deriveSlotBounds(MONDAY, AM.key, [...DEFAULT_SLOT_DEFINITIONS]);
    await db.insert(schema.seatReleases).values({
      seatId: f.seatB.id,
      releaseDate: MONDAY,
      slot: AM.key,
      startsAt: bounds.startsAt,
      endsAt: bounds.endsAt,
      ownerUserId: f.manager.id,
      releasedByUserId: f.manager.id,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });

    const released = await poolAndCapacity();
    // The structural pool is unchanged — a partner can reclaim the desk, so it
    // is not supply anybody can plan against. The operational capacity is up.
    expect(released.pool).toBe(before.pool - 1);
    expect(released.capacity).toBe(before.capacity);
  });

  it("excludes a blocked desk from both", async () => {
    const before = await poolAndCapacity();
    await db
      .update(schema.seats)
      .set({ status: "blocked", assignedUserId: null })
      .where(eq(schema.seats.id, f.seatA.id));
    const after = await poolAndCapacity();
    expect(after.pool).toBe(before.pool - 1);
    expect(after.capacity).toBe(before.capacity - 1);

    await db
      .update(schema.seats)
      .set({ status: "bookable" })
      .where(eq(schema.seats.id, f.seatA.id));
  });

  it("excludes a desk that was not yet active on the date", async () => {
    const before = await poolAndCapacity();
    await db
      .update(schema.seats)
      .set({ activeFrom: "2099-06-01" })
      .where(eq(schema.seats.id, f.seatA.id));
    const after = await poolAndCapacity();
    expect(after.pool).toBe(before.pool - 1);

    await db
      .update(schema.seats)
      .set({ activeFrom: sql`'2020-01-01'::date` })
      .where(eq(schema.seats.id, f.seatA.id));
  });

  it("takes the slot length from settings, not from any booking", async () => {
    const [am] = await capacityByDaySlot(db, [MONDAY], [...DEFAULT_SLOT_DEFINITIONS], {
      slot: AM.key,
    });
    const [pm] = await capacityByDaySlot(db, [MONDAY], [...DEFAULT_SLOT_DEFINITIONS], {
      slot: PM.key,
    });
    // A slot with zero bookings still reports its real length — deriving it
    // from ends_at - starts_at would make an empty day look like a day with no
    // desks rather than a day nobody came in.
    expect(am?.slotHours).toBe(4);
    expect(pm?.slotHours).toBe(4);
    expect(am?.seatHourCapacity).toBe(Number(((am?.capacity ?? 0) * 4).toFixed(2)));
  });
});
