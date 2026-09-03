/**
 * Taking a desk out of service, and deactivating a person.
 *
 * EDGE CASES 7, 8 AND 12 — and the rule invented to settle them.
 *
 * The brief says: "a seat is set to fixed or blocked while future bookings
 * exist … block the status change, or force-cancel with notification. Pick one,
 * log the decision."
 *
 * THE RULE: refuse by default, with the affected bookings listed; allow it with
 * an explicit `force`, which cancels them as `cancelled_by_admin` and notifies
 * every affected occupant and booker.
 *
 * Why both halves rather than one. Blocking outright is the safe default — an
 * admin dragging a desk in the editor and flipping its status should not
 * silently unseat four people, and the list is exactly the information needed
 * to decide. But refusing outright is also wrong: a desk really does break, and
 * an admin who cannot record that ends up with a floor plan that lies. `force`
 * makes the destruction deliberate and auditable rather than accidental.
 *
 * `cancelled_by_admin` is a distinct status for the same reason
 * `cancelled_after_check_in` is: analytics must not read "the firm took this
 * desk away" as "this person chose not to come in".
 */
import { eq } from "drizzle-orm";

import { writeAudit } from "@/lib/audit";
import { assertAdmin } from "@/lib/booking/authorise";
import { BookingError } from "@/lib/booking/errors";
import { futureBookingsForSeat, futureBookingsForUser } from "@/lib/booking/queries";
import { cancelBooking } from "@/lib/booking/service";
import type { Clock } from "@/lib/clock";
import { schema, type Db } from "@/lib/db";
import type { SeatStatus, User } from "@/lib/db/schema";

export interface LifecycleContext {
  db: Db;
  clock: Clock;
  actor: User;
}

/** Statuses that stop a desk being usable by whoever has already booked it. */
const UNBOOKABLE: ReadonlySet<SeatStatus> = new Set(["fixed", "blocked", "decommissioned"]);

export interface SeatStatusChangeResult {
  seatCode: string;
  status: SeatStatus;
  cancelledBookingIds: string[];
}

export async function changeSeatStatus(
  ctx: LifecycleContext,
  seatCode: string,
  nextStatus: SeatStatus,
  options: { force?: boolean } = {},
): Promise<SeatStatusChangeResult> {
  assertAdmin(ctx.actor);
  const now = ctx.clock.now();

  const [seat] = await ctx.db
    .select()
    .from(schema.seats)
    .where(eq(schema.seats.seatCode, seatCode))
    .limit(1);
  if (!seat) throw new BookingError("SEAT_NOT_FOUND", `There is no desk ${seatCode}.`);

  const cancelledBookingIds: string[] = [];

  if (UNBOOKABLE.has(nextStatus) && seat.status !== nextStatus) {
    const affected = await futureBookingsForSeat(ctx.db, seat.id, now);

    if (affected.length > 0 && !options.force) {
      throw new BookingError(
        "SEAT_HAS_FUTURE_BOOKINGS",
        `${seatCode} has ${affected.length} booking${
          affected.length === 1 ? "" : "s"
        } still to come. Confirm to cancel ${
          affected.length === 1 ? "it" : "them"
        } and tell the ${affected.length === 1 ? "person" : "people"} affected.`,
        { affected },
      );
    }

    // Cancel through the ordinary service so every one of these gets its
    // notification, its audit row and its status transition from the same code
    // an individual cancellation uses. A bulk UPDATE here would be quicker and
    // would silently skip all three.
    for (const booking of affected) {
      await cancelBooking(ctx, {
        bookingId: booking.id,
        force: true,
        byAdmin: true,
        reason:
          nextStatus === "decommissioned"
            ? `${seatCode} has been taken out of the floor plan, so this booking has been cancelled. Please book another desk.`
            : nextStatus === "blocked"
              ? `${seatCode} has been taken out of service, so this booking has been cancelled. Please book another desk.`
              : `${seatCode} has been allocated as a fixed desk, so this booking has been cancelled. Please book another desk.`,
      });
      cancelledBookingIds.push(booking.id);
    }
  }

  await ctx.db
    .update(schema.seats)
    .set({ status: nextStatus })
    .where(eq(schema.seats.id, seat.id));

  await writeAudit(ctx.db, {
    actorUserId: ctx.actor.id,
    entity: "seats",
    entityId: seat.id,
    action: "update_status",
    before: { status: seat.status },
    after: { status: nextStatus, cancelledBookings: cancelledBookingIds.length },
  });

  return { seatCode, status: nextStatus, cancelledBookingIds };
}

export interface DeactivateResult {
  userId: string;
  isActive: boolean;
  cancelledBookingIds: string[];
}

/**
 * EDGE CASE 12. Somebody leaves the firm, or goes on long leave.
 *
 * Their future bookings are cancelled — a desk held by somebody who no longer
 * has an account is capacity the floor has lost for no reason — and both the
 * occupant and whoever booked it are told. There is no `force` here: leaving
 * the bookings in place is not a defensible option, because nobody is coming.
 */
export async function setUserActive(
  ctx: LifecycleContext,
  userId: string,
  isActive: boolean,
): Promise<DeactivateResult> {
  assertAdmin(ctx.actor);
  const now = ctx.clock.now();

  const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw new BookingError("USER_NOT_FOUND", "That person is not on the staff list.");

  const cancelledBookingIds: string[] = [];

  if (!isActive && user.isActive) {
    const affected = await futureBookingsForUser(ctx.db, userId, now);
    for (const booking of affected) {
      await cancelBooking(ctx, {
        bookingId: booking.id,
        force: true,
        byAdmin: true,
        reason: `${user.displayName}'s account has been deactivated, so this desk booking has been cancelled.`,
      });
      cancelledBookingIds.push(booking.id);
    }
  }

  await ctx.db.update(schema.users).set({ isActive }).where(eq(schema.users.id, userId));

  await writeAudit(ctx.db, {
    actorUserId: ctx.actor.id,
    entity: "users",
    entityId: userId,
    action: isActive ? "activate" : "deactivate",
    before: { isActive: user.isActive },
    after: { isActive, cancelledBookings: cancelledBookingIds.length },
  });

  return { userId, isActive, cancelledBookingIds };
}
