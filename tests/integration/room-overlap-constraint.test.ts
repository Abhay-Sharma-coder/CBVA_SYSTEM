import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  asPgError,
  createFixtures,
  destroyFixtures,
  insertRoomBooking,
  openClient,
  testPool,
  type Fixtures,
} from "../helpers";

/**
 * PROVES: no_room_overlap (drizzle/0001_constraints.sql).
 *
 *   ALTER TABLE room_bookings ADD CONSTRAINT no_room_overlap
 *     EXCLUDE USING gist (room_id WITH =,
 *                         tstzrange(starts_at, ends_at, '[)') WITH &&)
 *     WHERE (status = 'confirmed');
 *
 * Rooms are booked as arbitrary ranges, not fixed slots, so uniqueness cannot
 * express this — it needs a GiST exclusion constraint over the time range.
 */
describe("no_room_overlap", () => {
  let pool: Pool;
  let f: Fixtures;
  const D = "2099-02-10";

  beforeAll(async () => {
    pool = testPool();
    f = await createFixtures(pool);
  });

  afterAll(async () => {
    await destroyFixtures(pool, f);
    await pool.end();
  });

  async function clear() {
    await pool.query(`delete from room_bookings where room_id = $1`, [f.roomId]);
  }

  it("rejects a booking that overlaps an existing one", async () => {
    await insertRoomBooking(pool, f, `${D}T04:00:00Z`, `${D}T06:00:00Z`);

    await expect(
      insertRoomBooking(pool, f, `${D}T05:00:00Z`, `${D}T07:00:00Z`),
    ).rejects.toMatchObject({ code: "23P01", constraint: "no_room_overlap" });

    await clear();
  });

  it("rejects a booking wholly contained inside another", async () => {
    await insertRoomBooking(pool, f, `${D}T04:00:00Z`, `${D}T08:00:00Z`);
    await expect(
      insertRoomBooking(pool, f, `${D}T05:00:00Z`, `${D}T06:00:00Z`),
    ).rejects.toMatchObject({ code: "23P01" });
    await clear();
  });

  it("rejects a booking that wholly contains another", async () => {
    await insertRoomBooking(pool, f, `${D}T05:00:00Z`, `${D}T06:00:00Z`);
    await expect(
      insertRoomBooking(pool, f, `${D}T04:00:00Z`, `${D}T08:00:00Z`),
    ).rejects.toMatchObject({ code: "23P01" });
    await clear();
  });

  it("allows back-to-back bookings, because the range is half-open", async () => {
    // 10:00–11:00 then 11:00–12:00. The '[)' bound is what makes the second
    // one legal; with '[]' every consecutive meeting would be refused.
    await insertRoomBooking(pool, f, `${D}T04:30:00Z`, `${D}T05:30:00Z`);
    await expect(
      insertRoomBooking(pool, f, `${D}T05:30:00Z`, `${D}T06:30:00Z`),
    ).resolves.toBeTruthy();
    await clear();
  });

  it("ignores cancelled bookings, so a released room can be rebooked", async () => {
    await insertRoomBooking(pool, f, `${D}T04:00:00Z`, `${D}T06:00:00Z`, "cancelled");
    await expect(
      insertRoomBooking(pool, f, `${D}T04:00:00Z`, `${D}T06:00:00Z`, "confirmed"),
    ).resolves.toBeTruthy();
    await clear();
  });

  it("allows the same time range in a different room", async () => {
    const other = await createFixtures(pool);
    try {
      await insertRoomBooking(pool, f, `${D}T04:00:00Z`, `${D}T06:00:00Z`);
      await expect(
        insertRoomBooking(pool, other, `${D}T04:00:00Z`, `${D}T06:00:00Z`),
      ).resolves.toBeTruthy();
    } finally {
      await destroyFixtures(pool, other);
      await clear();
    }
  });

  it("rejects an empty range, which would otherwise overlap nothing", async () => {
    // An empty or inverted range slips past an exclusion constraint entirely —
    // it overlaps nothing by definition. The CHECK catches it instead.
    await expect(
      insertRoomBooking(pool, f, `${D}T05:00:00Z`, `${D}T05:00:00Z`),
    ).rejects.toMatchObject({ constraint: "room_booking_range_valid" });

    await expect(
      insertRoomBooking(pool, f, `${D}T06:00:00Z`, `${D}T05:00:00Z`),
    ).rejects.toMatchObject({ constraint: "room_booking_range_valid" });
  });

  /** Same race as the seat test, against the exclusion constraint. */
  it("lets exactly one of two concurrent transactions win the room", async () => {
    const a = await openClient();
    const b = await openClient();

    try {
      await a.query("BEGIN");
      await b.query("BEGIN");

      await insertRoomBooking(a, f, `${D}T09:00:00Z`, `${D}T10:00:00Z`);

      // Overlapping range from the other session, before A commits.
      const bInsert = insertRoomBooking(b, f, `${D}T09:30:00Z`, `${D}T10:30:00Z`);

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

      const outcome = await bInsert.then(
        () => ({ ok: true as const }),
        (err) => ({ ok: false as const, err: asPgError(err) }),
      );

      expect(outcome.ok, "B must not also get the room").toBe(false);
      if (!outcome.ok) {
        expect(outcome.err.code).toBe("23P01");
        expect(outcome.err.constraint).toBe("no_room_overlap");
      }

      await b.query("ROLLBACK");

      const { rows } = await pool.query(
        `select count(*)::int as n from room_bookings
         where room_id = $1 and status = 'confirmed'`,
        [f.roomId],
      );
      expect(rows[0].n, "exactly one confirmed room booking survives").toBe(1);
    } finally {
      await a.end().catch(() => {});
      await b.end().catch(() => {});
      await clear();
    }
  });
});
