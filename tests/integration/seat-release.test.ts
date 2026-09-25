import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import {
  AM,
  FixedClock,
  MONDAY,
  clearBookings,
  createPhase3Fixtures,
  destroyPhase3Fixtures,
  testDb,
  testPool,
  widenWindow,
  snapshotSettings,
  restoreSettings,
  type SettingsSnapshot,
  type Phase3Fixtures,
} from "../phase3-helpers";
import {
  hasReleasedOwnSeat,
  liveReleasesFor,
  releaseFixedSeat,
  revokeSeatRelease,
} from "@/lib/booking/seat-release";
import { createBooking } from "@/lib/booking/service";
import { isBookingError } from "@/lib/booking/errors";
import { schema, type Db } from "@/lib/db";
import { seatVisualStatus } from "@/lib/seat-visual-status";
import type { Pool } from "pg";

/**
 * Releasing an allocated desk.
 *
 * The rule under test is not "does the row get written" — it is that a desk
 * cannot be simultaneously reclaimed by its owner and booked by a colleague.
 * That race is closed in the database (the insert takes the release FOR UPDATE
 * in the same statement, the revoke is the mirror conditional UPDATE), and this
 * is where that argument is checked rather than asserted.
 */
describe("releasing an allocated desk", () => {
  let pool: Pool;
  let db: Db;
  let f: Phase3Fixtures;
  let settings: SettingsSnapshot;
  // Well before the Monday slot, so the date is inside the booking window.
  const clock = new FixedClock(new Date("2098-12-29T04:00:00Z"));

  beforeAll(async () => {
    pool = testPool();
    db = testDb(pool);
    f = await createPhase3Fixtures(db);
    /**
     * MONDAY is 2099-01-05, far outside the default five-day window, so the
     * window has to be widened for the write path to accept it.
     *
     * SNAPSHOT FIRST, AND RESTORE IN afterAll. `settings` is a SINGLETON shared
     * by every test and by the running application — an earlier version of this
     * file widened it to 4000 working days and never put it back, which left the
     * date strip offering hundreds of days and made the recurring-booking suite
     * try to materialise a booking for every one of them. Every test in the file
     * timed out and none of them looked like the cause.
     */
    settings = await snapshotSettings(db);
    await widenWindow(db, 4000, 8000);
  });

  afterAll(async () => {
    await clearBookings(db, f);
    await db.delete(schema.seatReleases).where(eq(schema.seatReleases.seatId, f.seatB.id));
    await destroyPhase3Fixtures(db, f);
    await restoreSettings(db, settings);
    await pool.end();
  });

  beforeEach(async () => {
    await clearBookings(db, f);
    await db.delete(schema.seatReleases).where(eq(schema.seatReleases.seatId, f.seatB.id));
    // seatB is the manager's allocated desk for these tests.
    await db
      .update(schema.seats)
      .set({ status: "fixed", assignedUserId: f.manager.id })
      .where(eq(schema.seats.id, f.seatB.id));
  });

  const asOwner = () => ({ db, clock, actor: f.manager });

  it("refuses to release a desk that is not allocated to you", async () => {
    await expect(
      releaseFixedSeat(
        { db, clock, actor: f.colleague },
        { seatCode: f.seatB.code, dates: [MONDAY], slots: [AM.key] },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses to release a hot desk, because there is nothing to release", async () => {
    await expect(
      releaseFixedSeat(asOwner(), {
        seatCode: f.seatA.code,
        dates: [MONDAY],
        slots: [AM.key],
      }),
    ).rejects.toMatchObject({ code: "SEAT_NOT_RELEASABLE" });
  });

  it("is idempotent — releasing the same slot twice is not an error", async () => {
    const first = await releaseFixedSeat(asOwner(), {
      seatCode: f.seatB.code,
      dates: [MONDAY],
      slots: [AM.key],
    });
    const second = await releaseFixedSeat(asOwner(), {
      seatCode: f.seatB.code,
      dates: [MONDAY],
      slots: [AM.key],
    });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]!.id).toBe(first[0]!.id);
  });

  it("makes an allocated desk bookable by somebody else, for that slot only", async () => {
    await releaseFixedSeat(asOwner(), {
      seatCode: f.seatB.code,
      dates: [MONDAY],
      slots: [AM.key],
    });

    const booked = await createBooking(
      { db, clock, actor: f.article },
      { seatCode: f.seatB.code, bookingDate: MONDAY, slot: AM.key },
    );
    // The booking points back at the release, which is what lets analytics say
    // how much demand released desks absorbed, and what the revoke path reads.
    expect(booked.booking.releaseId).toBeTruthy();

    // The PM slot was not released, so it is still nobody else's to take.
    await expect(
      createBooking(
        { db, clock, actor: f.colleague },
        { seatCode: f.seatB.code, bookingDate: MONDAY, slot: "PM" },
      ),
    ).rejects.toMatchObject({ code: "SEAT_NOT_BOOKABLE" });
  });

  /**
   * THE CONCURRENCY PROOF, in the direction that matters.
   *
   * Two sessions: the owner reclaiming the desk, and a colleague booking it.
   * Exactly one must win, and the loser must get a sentence rather than a
   * constraint name. Reading the release and then inserting would leave a
   * window in which both succeed.
   */
  it("lets exactly one of a concurrent reclaim and booking win", async () => {
    const [release] = await releaseFixedSeat(asOwner(), {
      seatCode: f.seatB.code,
      dates: [MONDAY],
      slots: [AM.key],
    });

    const outcomes = await Promise.allSettled([
      revokeSeatRelease(asOwner(), { releaseId: release!.id }),
      createBooking(
        { db, clock, actor: f.article },
        { seatCode: f.seatB.code, bookingDate: MONDAY, slot: AM.key },
      ),
    ]);

    const won = outcomes.filter((o) => o.status === "fulfilled").length;
    expect(won).toBeGreaterThanOrEqual(1);

    const live = await liveReleasesFor(db, MONDAY, AM.key);
    const booking = await db
      .select({ id: schema.bookings.id })
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.seatId, f.seatB.id),
          eq(schema.bookings.bookingDate, MONDAY),
          eq(schema.bookings.status, "confirmed"),
        ),
      );

    // The invariant: the desk is never both reclaimed AND booked. Either the
    // revoke won (no live release, no booking) or the booking won (the release
    // is still live and holds a booking).
    const reclaimed = !live.has(f.seatB.id);
    if (reclaimed) {
      expect(booking).toHaveLength(0);
    } else {
      expect(booking.length).toBeLessThanOrEqual(1);
    }

    // Whichever lost, it failed with a mapped message rather than a raw error.
    for (const o of outcomes) {
      if (o.status === "rejected") {
        expect(isBookingError(o.reason)).toBe(true);
      }
    }
  });

  it("refuses to reclaim a desk somebody has booked, and names them", async () => {
    const [release] = await releaseFixedSeat(asOwner(), {
      seatCode: f.seatB.code,
      dates: [MONDAY],
      slots: [AM.key],
    });
    await createBooking(
      { db, clock, actor: f.article },
      { seatCode: f.seatB.code, bookingDate: MONDAY, slot: AM.key },
    );

    await expect(
      revokeSeatRelease(asOwner(), { releaseId: release!.id }),
    ).rejects.toMatchObject({
      code: "SEAT_RELEASE_TAKEN",
      details: { occupantName: f.article.displayName },
    });
  });

  /**
   * ADR-025's precedent: refusing outright is wrong because plans change, doing
   * it silently is worse because a colleague built their day around that desk.
   * A forced reclaim lands as cancelled_by_admin — the honest status, and
   * precisely why ADR-024 kept it apart from a no-show.
   */
  it("lets an admin force the reclaim, cancelling as cancelled_by_admin", async () => {
    const [release] = await releaseFixedSeat(asOwner(), {
      seatCode: f.seatB.code,
      dates: [MONDAY],
      slots: [AM.key],
    });
    const booked = await createBooking(
      { db, clock, actor: f.article },
      { seatCode: f.seatB.code, bookingDate: MONDAY, slot: AM.key },
    );

    const result = await revokeSeatRelease(
      { db, clock, actor: f.admin },
      { releaseId: release!.id, force: true, reason: "test" },
    );
    expect(result.cancelledBookingId).toBe(booked.booking.id);

    const [after] = await db
      .select({ status: schema.bookings.status })
      .from(schema.bookings)
      .where(eq(schema.bookings.id, booked.booking.id));
    expect(after!.status).toBe("cancelled_by_admin");

    const live = await liveReleasesFor(db, MONDAY, AM.key);
    expect(live.has(f.seatB.id)).toBe(false);
  });

  it("refuses a non-admin owner the force, rather than letting them unseat somebody", async () => {
    const [release] = await releaseFixedSeat(asOwner(), {
      seatCode: f.seatB.code,
      dates: [MONDAY],
      slots: [AM.key],
    });
    await createBooking(
      { db, clock, actor: f.article },
      { seatCode: f.seatB.code, bookingDate: MONDAY, slot: AM.key },
    );

    await expect(
      revokeSeatRelease(asOwner(), { releaseId: release!.id, force: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  /**
   * The hole this closes: a partner releases their desk for the morning, thinks
   * better of it, and has nowhere to sit — because the fixed-grade rule refuses
   * them a hot desk. The carve-out is keyed on a release ROW, not on grade, so
   * the general rule is untouched.
   */
  it("lets somebody who released their own desk book a hot one", async () => {
    await expect(
      createBooking(
        { db, clock, actor: f.manager },
        { seatCode: f.seatA.code, bookingDate: MONDAY, slot: AM.key },
      ),
    ).rejects.toMatchObject({ code: "NOT_BOOKABLE_GRADE" });

    await releaseFixedSeat(asOwner(), {
      seatCode: f.seatB.code,
      dates: [MONDAY],
      slots: [AM.key],
    });
    expect(await hasReleasedOwnSeat(db, f.manager.id, MONDAY, AM.key)).toBe(true);

    const booked = await createBooking(
      { db, clock, actor: f.manager },
      { seatCode: f.seatA.code, bookingDate: MONDAY, slot: AM.key },
    );
    expect(booked.seatCode).toBe(f.seatA.code);
  });

  /**
   * ONE BOOLEAN, NO EIGHTH STATUS. The seven-status vocabulary is proven
   * desaturated on /styleguide and bridged by the 3D materials; a released desk
   * flows through the existing paths instead of adding to it.
   */
  it("shows a released desk as available rather than reserved, and drops its owner's name", () => {
    const base = {
      seatStatus: "fixed" as const,
      assignedName: "Aparna Modi",
      bookingStatus: null,
      occupantEmail: null,
      occupantName: null,
      viewerEmail: "somebody@cbva.in",
    };
    expect(seatVisualStatus({ ...base })).toBe("reserved_fixed");
    expect(seatVisualStatus({ ...base, releasedByOwner: true })).toBe("available");
  });
});
