/**
 * "Switching to hourly must be a settings change, not a refactor. Prove it."
 *
 * CBVA's document says hourly; its only worked example is a half day, and the
 * deck we showed them uses half days. So half days ship — but if the firm comes
 * back and asks for hourly, the answer has to be a settings write, not a
 * quarter's work. This file is the proof, and it is deliberately unglamorous:
 * it reconfigures `settings.slot_definitions` to eight one-hour slots and then
 * runs the ENTIRE desk lifecycle — book, check in, edit, cancel, auto-release —
 * against a slot key (`H10`) that did not exist when the code was written.
 *
 * Nothing in `src/` is aware of this test. If anybody ever reintroduces an
 * AM/PM type, a hardcoded slot list, or a second copy of `deriveSlotBounds`,
 * this is what fails.
 *
 * `settings` is a singleton shared with the dev server and every other spec, so
 * it is snapshotted and restored without fail.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { eq } from "drizzle-orm";

import { updateSettings } from "@/lib/admin/settings-service";
import { runAutoRelease } from "@/lib/booking/auto-release";
import {
  cancelBooking,
  checkInBooking,
  createBooking,
  editBooking,
} from "@/lib/booking/service";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { hourlySlotDefinitions } from "@/lib/slots";

import {
  bookingById,
  clearBookings,
  createPhase3Fixtures,
  destroyPhase3Fixtures,
  FixedClock,
  MINUTE,
  MONDAY,
  restoreSettings,
  snapshotSettings,
  testDb,
  testPool,
  type Phase3Fixtures,
  type SettingsSnapshot,
} from "../phase3-helpers";

/** Monday 5 January 2099, 07:00 IST — before every slot of the day. */
const MONDAY_0700_IST = new Date("2099-01-05T01:30:00Z");
/** 10:00 IST, when the H10 slot starts. */
const H10_START = new Date("2099-01-05T04:30:00Z");
const H10_END = new Date("2099-01-05T05:30:00Z");

let pool: Pool;
let db: Db;
let f: Phase3Fixtures;
let snap: SettingsSnapshot;

beforeAll(async () => {
  pool = testPool(6);
  db = testDb(pool);
  snap = await snapshotSettings(db);
  f = await createPhase3Fixtures(db);
});

afterAll(async () => {
  await clearBookings(db, f);
  await destroyPhase3Fixtures(db, f);
  // Without this the dev database is left running hourly slots and every other
  // spec, and the demo, quietly changes shape.
  await restoreSettings(db, snap);
  await pool.end();
});

describe("reconfiguring the firm to hourly booking", () => {
  it("is a settings write, and the whole booking lifecycle still works", async () => {
    const clock = new FixedClock(MONDAY_0700_IST);
    const ctx = (actor: schema.User) => ({ db, clock, actor });

    /* ---- the entire change ---- */
    const hourly = hourlySlotDefinitions(9, 17);
    expect(hourly.map((d) => d.key)).toEqual([
      "H09",
      "H10",
      "H11",
      "H12",
      "H13",
      "H14",
      "H15",
      "H16",
    ]);

    await updateSettings(ctx(f.admin), { slotDefinitions: hourly });

    const settings = await getSettings(db);
    expect(settings.slotDefinitions).toHaveLength(8);
    expect(settings.slotDefinitions[1]).toMatchObject({
      key: "H10",
      start: "10:00",
      end: "11:00",
    });

    /* ---- book an hour ---- */
    const booked = await createBooking(ctx(f.article), {
      seatCode: f.seatA.code,
      bookingDate: MONDAY,
      slot: "H10",
    });
    expect(booked.booking.slot).toBe("H10");
    // The bounds came from the same deriveSlotBounds the half-day config uses.
    expect(booked.booking.startsAt.toISOString()).toBe(H10_START.toISOString());
    expect(booked.booking.endsAt.toISOString()).toBe(H10_END.toISOString());

    /* ---- a different hour on the same desk is a different slot ---- */
    const alsoBooked = await createBooking(ctx(f.colleague), {
      seatCode: f.seatA.code,
      bookingDate: MONDAY,
      slot: "H11",
    });
    expect(alsoBooked.booking.status).toBe("confirmed");

    /* ---- move it to another desk ---- */
    const moved = await editBooking(ctx(f.article), {
      bookingId: booked.booking.id,
      expectedUpdatedAt: booked.booking.updatedAt.toISOString(),
      seatCode: f.seatB.code,
      bookingDate: MONDAY,
      slot: "H10",
    });
    expect(moved.seatCode).toBe(f.seatB.code);
    expect(moved.booking.slot).toBe("H10");

    /* ---- check in during the hour ---- */
    clock.set(new Date(H10_START.getTime() + 5 * MINUTE));
    const checked = await checkInBooking(ctx(f.article), {
      seatCode: f.seatB.code,
      method: "qr",
    });
    expect(checked.booking.status).toBe("checked_in");
    expect(checked.slot.key).toBe("H10");

    /* ---- cancel after checking in ---- */
    const cancelled = await cancelBooking(ctx(f.article), { bookingId: moved.booking.id });
    expect(cancelled.status).toBe("cancelled_after_check_in");

    /* ---- and auto-release still runs the real rule on an hourly slot ---- */
    // The grace window is 120 minutes, which is longer than an hour-long slot,
    // so an un-checked-in hourly booking never "releases" — by the time the
    // window expires the hour is over and it settles as a no-show instead.
    // That is the correct outcome and precisely the sort of interaction a
    // settings change can produce, which is why this is asserted rather than
    // assumed.
    clock.set(new Date("2099-01-05T05:35:00Z")); // 11:05 IST, H11 running
    const during = await runAutoRelease({ db, clock });
    expect(during.released).toBe(0);

    clock.set(new Date("2099-01-05T08:00:00Z")); // 13:30 IST, well past H11
    const after = await runAutoRelease({ db, clock });
    expect(after.markedNoShow).toBeGreaterThanOrEqual(1);
    expect((await bookingById(db, alsoBooked.booking.id))!.status).toBe("completed_no_show");
  });

  it("refuses a slot key that the new definitions do not contain", async () => {
    const clock = new FixedClock(MONDAY_0700_IST);
    await expect(
      createBooking(
        { db, clock, actor: f.article },
        { seatCode: f.seatA.code, bookingDate: MONDAY, slot: "AM" },
      ),
    ).rejects.toMatchObject({ code: "UNKNOWN_SLOT" });
  });

  it("refuses to drop a slot that live bookings still use, rather than orphaning them", async () => {
    const clock = new FixedClock(MONDAY_0700_IST);
    const ctx = (actor: schema.User) => ({ db, clock, actor });

    await createBooking(ctx(f.colleague), {
      seatCode: f.seatA.code,
      bookingDate: MONDAY,
      slot: "H12",
    });

    // A booking whose slot key no longer exists has no start time that could be
    // computed for it, so the change is refused with the list rather than
    // leaving rows nobody can interpret.
    await expect(
      updateSettings(ctx(f.admin), { slotDefinitions: hourlySlotDefinitions(13, 17) }),
    ).rejects.toMatchObject({ code: "UNKNOWN_SLOT" });

    await clearBookings(db, f);
  });

  it("backfills stored bounds when a boundary moves — ADR-007's open problem", async () => {
    const clock = new FixedClock(MONDAY_0700_IST);
    const ctx = (actor: schema.User) => ({ db, clock, actor });

    const booked = await createBooking(ctx(f.article), {
      seatCode: f.seatA.code,
      bookingDate: MONDAY,
      slot: "H14",
    });
    expect(booked.booking.startsAt.toISOString()).toBe("2099-01-05T08:30:00.000Z"); // 14:00 IST

    // Shift every hourly slot half an hour later. Under ADR-007's original
    // design the settings row and this booking would now disagree about when
    // 14:00 is, for ever.
    const shifted = hourlySlotDefinitions(9, 17).map((d) => ({
      ...d,
      start: `${d.start.slice(0, 2)}:30`,
      end: `${String(Number(d.end.slice(0, 2))).padStart(2, "0")}:30`,
    }));
    const result = await updateSettings(ctx(f.admin), { slotDefinitions: shifted });

    expect(result.backfilled).toBeGreaterThanOrEqual(1);
    const after = await bookingById(db, booked.booking.id);
    expect(
      after!.startsAt.toISOString(),
      "the stored bounds moved with the definition that produced them",
    ).toBe("2099-01-05T09:00:00.000Z"); // 14:30 IST

    await db.delete(schema.bookings).where(eq(schema.bookings.id, booked.booking.id));
  });
});
