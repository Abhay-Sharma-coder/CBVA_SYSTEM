import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  asPgError,
  createFixtures,
  destroyFixtures,
  insertBooking,
  openClient,
  testPool,
  type Fixtures,
} from "../helpers";

/**
 * PROVES: seat_slot_unique (drizzle/0001_constraints.sql).
 *
 *   CREATE UNIQUE INDEX seat_slot_unique ON bookings (seat_id, booking_date, slot)
 *     WHERE status IN ('confirmed','checked_in');
 *
 * This rule is in the database rather than the app on purpose. An app-level
 * "is this seat free?" check has a race window between the read and the write,
 * and two people tapping Book at the same moment is precisely the case that has
 * to not double-book. The last test in this file demonstrates that window
 * closing.
 */
describe("seat_slot_unique", () => {
  let pool: Pool;
  let f: Fixtures;

  beforeAll(async () => {
    pool = testPool();
    f = await createFixtures(pool);
  });

  afterAll(async () => {
    await destroyFixtures(pool, f);
    await pool.end();
  });

  it("rejects a second confirmed booking on the same seat, date and slot", async () => {
    await insertBooking(pool, f, { slot: "AM", status: "confirmed" });

    await expect(
      insertBooking(pool, f, { slot: "AM", status: "confirmed" }),
    ).rejects.toMatchObject({ code: "23505", constraint: "seat_slot_unique" });

    await pool.query(`delete from bookings where seat_id = $1`, [f.seatId]);
  });

  it("rejects a checked_in booking colliding with a confirmed one", async () => {
    // Both statuses are inside the partial index predicate, so they collide
    // with each other and not just with themselves.
    await insertBooking(pool, f, { slot: "AM", status: "confirmed" });

    await expect(
      insertBooking(pool, f, { slot: "AM", status: "checked_in" }),
    ).rejects.toMatchObject({ code: "23505" });

    await pool.query(`delete from bookings where seat_id = $1`, [f.seatId]);
  });

  it("allows the same seat and date in the other slot", async () => {
    await insertBooking(pool, f, { slot: "AM" });
    await expect(insertBooking(pool, f, { slot: "PM" })).resolves.toBeTruthy();
    await pool.query(`delete from bookings where seat_id = $1`, [f.seatId]);
  });

  it("frees the slot once a booking is cancelled or auto-released", async () => {
    // The predicate is the whole point: a cancelled booking must leave the slot
    // bookable while its history survives, rather than being deleted.
    for (const released of ["cancelled_by_user", "auto_released", "completed_no_show"]) {
      await insertBooking(pool, f, { slot: "AM", status: released });
    }

    await expect(
      insertBooking(pool, f, { slot: "AM", status: "confirmed" }),
    ).resolves.toBeTruthy();

    const { rows } = await pool.query(
      `select count(*)::int as n from bookings where seat_id = $1`,
      [f.seatId],
    );
    // Four rows coexist: three released, one live. The audit trail is intact.
    expect(rows[0].n).toBe(4);

    await pool.query(`delete from bookings where seat_id = $1`, [f.seatId]);
  });

  it("rejects re-confirming a cancelled row while another booking is live", async () => {
    const cancelledId = crypto.randomUUID();
    await insertBooking(pool, f, { slot: "AM", status: "cancelled_by_user", id: cancelledId });
    await insertBooking(pool, f, { slot: "AM", status: "confirmed" });

    // An UPDATE has to be caught by the index too, not only an INSERT.
    await expect(
      pool.query(`update bookings set status = 'confirmed' where id = $1`, [cancelledId]),
    ).rejects.toMatchObject({ code: "23505" });

    await pool.query(`delete from bookings where seat_id = $1`, [f.seatId]);
  });

  /**
   * THE ONE THAT MATTERS.
   *
   * Two separate sessions, two real transactions, both inserting the same
   * seat/date/slot before either commits. Exactly one may survive.
   */
  it("lets exactly one of two concurrent transactions win the seat", async () => {
    const a = await openClient();
    const b = await openClient();

    try {
      await a.query("BEGIN");
      await b.query("BEGIN");

      // A inserts and holds the row uncommitted.
      await insertBooking(a, f, { slot: "AM", status: "confirmed" });

      // B attempts the same seat/slot. Postgres blocks it on A's uncommitted
      // index entry rather than failing immediately, so this promise stays
      // pending until A resolves — which is exactly the behaviour that closes
      // the race window an app-level check would leave open.
      const bInsert = insertBooking(b, f, { slot: "AM", status: "confirmed" });

      let bSettledEarly = false;
      bInsert.then(
        () => (bSettledEarly = true),
        () => (bSettledEarly = true),
      );
      await new Promise((r) => setTimeout(r, 300));
      expect(
        bSettledEarly,
        "B should still be blocked while A's transaction is open",
      ).toBe(false);

      await a.query("COMMIT");

      // With A committed, B's insert now violates the unique index.
      const outcome = await bInsert.then(
        () => ({ ok: true as const }),
        (err) => ({ ok: false as const, err: asPgError(err) }),
      );

      expect(outcome.ok, "B must not also get the seat").toBe(false);
      if (!outcome.ok) {
        expect(outcome.err.code).toBe("23505");
        expect(outcome.err.constraint).toBe("seat_slot_unique");
      }

      await b.query("ROLLBACK");

      const { rows } = await pool.query(
        `select count(*)::int as n from bookings
         where seat_id = $1 and booking_date = $2 and slot = 'AM'
           and status in ('confirmed','checked_in')`,
        [f.seatId, f.bookingDate],
      );
      expect(rows[0].n, "exactly one live booking survives").toBe(1);
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
      await pool.query(`delete from bookings where seat_id = $1`, [f.seatId]);
    }
  });
});
