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
import { revokeFutureReleasesForSeat } from "@/lib/booking/seat-release";
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
  /** Live future releases invalidated by the change. See the note below. */
  revokedReleases: number;
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

  /**
   * A desk that is no longer `fixed`, or that has gone out of service, must not
   * leave live releases behind it.
   *
   * A release on a desk nobody is allocated to is meaningless, and — because
   * capacity counts a released fixed desk — leaving one live would keep adding
   * a phantom desk to every occupancy denominator for that day. That is the
   * quietest possible way to make the analytics wrong.
   */
  let revokedReleases = 0;
  if (seat.status === "fixed" && nextStatus !== "fixed") {
    revokedReleases = await revokeFutureReleasesForSeat(ctx.db, seat.id, now, ctx.actor.id);
  } else if (UNBOOKABLE.has(nextStatus) && nextStatus !== "fixed") {
    revokedReleases = await revokeFutureReleasesForSeat(ctx.db, seat.id, now, ctx.actor.id);
  }

  /**
   * Allocation follows status, in both directions.
   *
   * `users.fixed_seat_id` and `seats.assigned_user_id` are two halves of one
   * fact, and until Phase 5 only the seed ever wrote either of them. A desk
   * that stops being fixed while still naming an occupant would show that
   * person's name on a hot desk anybody can book.
   */
  const clearAllocation = nextStatus !== "fixed" && seat.assignedUserId !== null;

  await ctx.db
    .update(schema.seats)
    .set({ status: nextStatus, ...(clearAllocation ? { assignedUserId: null } : {}) })
    .where(eq(schema.seats.id, seat.id));

  if (clearAllocation && seat.assignedUserId) {
    await ctx.db
      .update(schema.users)
      .set({ fixedSeatId: null })
      .where(eq(schema.users.id, seat.assignedUserId));
  }

  await writeAudit(ctx.db, {
    actorUserId: ctx.actor.id,
    entity: "seats",
    entityId: seat.id,
    action: "update_status",
    before: { status: seat.status, assignedUserId: seat.assignedUserId },
    after: {
      status: nextStatus,
      assignedUserId: clearAllocation ? null : seat.assignedUserId,
      cancelledBookings: cancelledBookingIds.length,
      revokedReleases,
    },
  });

  return { seatCode, status: nextStatus, cancelledBookingIds, revokedReleases };
}

export interface AssignSeatResult {
  seatCode: string;
  assignedUserId: string | null;
  previousUserId: string | null;
  cancelledBookingIds: string[];
}

/**
 * Allocate a desk to somebody, or clear the allocation.
 *
 * Answering ASSUMPTIONS A2 — which physical desks are allocated — is a
 * five-minute job in this screen rather than a code change, which is the whole
 * point of building it. Both halves of the relationship are written in one
 * transaction, because `seats_assigned_user_unique` means a half-written
 * allocation is a constraint violation waiting for the next edit.
 */
export async function assignFixedSeat(
  ctx: LifecycleContext,
  seatCode: string,
  userId: string | null,
  options: { force?: boolean } = {},
): Promise<AssignSeatResult> {
  assertAdmin(ctx.actor);
  const now = ctx.clock.now();

  const [seat] = await ctx.db
    .select()
    .from(schema.seats)
    .where(eq(schema.seats.seatCode, seatCode))
    .limit(1);
  if (!seat) throw new BookingError("SEAT_NOT_FOUND", `There is no desk ${seatCode}.`);

  const cancelledBookingIds: string[] = [];

  if (userId) {
    const [user] = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!user) throw new BookingError("USER_NOT_FOUND", "That person is not on the staff list.");

    // Allocating a hot desk takes it out of the bookable pool, so it is the
    // same destructive act as blocking one and gets the same treatment.
    const affected = await futureBookingsForSeat(ctx.db, seat.id, now);
    if (affected.length > 0 && !options.force) {
      throw new BookingError(
        "SEAT_HAS_FUTURE_BOOKINGS",
        `${seatCode} has ${affected.length} booking${
          affected.length === 1 ? "" : "s"
        } still to come. Confirm to cancel and reallocate.`,
        { affected },
      );
    }
    for (const booking of affected) {
      await cancelBooking(ctx, {
        bookingId: booking.id,
        force: true,
        byAdmin: true,
        reason: `${seatCode} has been allocated as a fixed desk, so this booking has been cancelled. Please book another desk.`,
      });
      cancelledBookingIds.push(booking.id);
    }
  }

  await ctx.db.transaction(async (tx) => {
    // Clear the previous holder first, or seats_assigned_user_unique refuses
    // the move while both rows briefly point at the same person.
    if (seat.assignedUserId) {
      await tx
        .update(schema.users)
        .set({ fixedSeatId: null })
        .where(eq(schema.users.id, seat.assignedUserId));
    }
    if (userId) {
      // And release whatever desk this person held before, so nobody ends up
      // holding two.
      await tx
        .update(schema.seats)
        .set({ status: "bookable", assignedUserId: null })
        .where(eq(schema.seats.assignedUserId, userId));
    }

    await tx
      .update(schema.seats)
      .set({ status: userId ? "fixed" : "bookable", assignedUserId: userId })
      .where(eq(schema.seats.id, seat.id));

    if (userId) {
      await tx
        .update(schema.users)
        .set({ fixedSeatId: seat.id, seatMode: "fixed" })
        .where(eq(schema.users.id, userId));
    }

    await writeAudit(tx, {
      actorUserId: ctx.actor.id,
      entity: "seats",
      entityId: seat.id,
      action: "update_status",
      before: { status: seat.status, assignedUserId: seat.assignedUserId },
      after: { status: userId ? "fixed" : "bookable", assignedUserId: userId },
    });
  });

  if (!userId) {
    await revokeFutureReleasesForSeat(ctx.db, seat.id, now, ctx.actor.id);
  }

  return {
    seatCode,
    assignedUserId: userId,
    previousUserId: seat.assignedUserId,
    cancelledBookingIds,
  };
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
