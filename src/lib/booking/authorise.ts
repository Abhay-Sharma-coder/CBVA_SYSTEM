/**
 * Who may write what.
 *
 * Pure functions over rows, so every rule here is unit-testable and none of it
 * depends on a request being in flight. Route handlers resolve the actor and
 * call in; nothing in this file touches the database or `next/headers`.
 */
import { BookingError } from "@/lib/booking/errors";
import type { Seat, User } from "@/lib/db/schema";

/** Grades that hold an allocated desk and therefore must not consume a hot one. */
const FIXED_GRADES = new Set(["partner", "director", "manager", "admin_staff"]);

/** Grades permitted to book for somebody else — see ASSUMPTIONS A7. */
const ON_BEHALF_GRADES = new Set(["manager", "director", "partner"]);

export function assertSignedIn(actor: User | null): asserts actor is User {
  if (!actor) {
    throw new BookingError("NOT_SIGNED_IN", "You need to be signed in to do that.");
  }
  if (!actor.isActive) {
    throw new BookingError("FORBIDDEN", "This account is no longer active.");
  }
}

/**
 * PROJECT.md's grade table: "Manager … book on behalf of their team", plus the
 * admin/HR/IT staff who seat people for a living. Confirmed with the client
 * team in Phase 3; it narrows ASSUMPTIONS A7, which had assumed anyone could.
 */
export function canBookOnBehalf(actor: User): boolean {
  return actor.isAdmin || ON_BEHALF_GRADES.has(actor.grade);
}

/**
 * May this person occupy a hot desk at all?
 *
 * A partner consuming a bookable desk is not a permission slip-up, it is a
 * capacity error: they already hold one, so the floor is now short by one and
 * every occupancy number is wrong by one. The analytics is the product, so this
 * is enforced rather than trusted.
 */
export function assertOccupantMayBook(occupant: User, bookingForSelf: boolean): void {
  if (!occupant.isActive) {
    throw new BookingError(
      "OCCUPANT_INACTIVE",
      `${occupant.displayName}'s account is no longer active, so a desk cannot be booked for them.`,
    );
  }
  if (occupant.seatMode !== "bookable" || FIXED_GRADES.has(occupant.grade)) {
    throw new BookingError(
      bookingForSelf ? "NOT_BOOKABLE_GRADE" : "OCCUPANT_NOT_BOOKABLE",
      bookingForSelf
        ? "You have an allocated desk, so there is nothing to book. Hot desks are for Assistant Manager grade and below."
        : `${occupant.displayName} has an allocated desk, so a hot desk cannot be booked for them.`,
    );
  }
}

export function assertMayBookFor(actor: User, occupant: User): void {
  const forSelf = actor.id === occupant.id;
  if (!forSelf && !canBookOnBehalf(actor)) {
    throw new BookingError(
      "NOT_PERMITTED_ON_BEHALF",
      "Booking for a colleague is available to managers and above, and to admin staff.",
    );
  }
  assertOccupantMayBook(occupant, forSelf);
}

export function assertSeatBookable(seat: Seat | undefined): asserts seat is Seat {
  if (!seat) {
    throw new BookingError("SEAT_NOT_FOUND", "That desk is not on the floor plan.");
  }
  if (seat.status !== "bookable") {
    const why: Record<string, string> = {
      fixed: `${seat.seatCode} is allocated to somebody, so it cannot be booked.`,
      blocked: `${seat.seatCode} is out of service.`,
      decommissioned: `${seat.seatCode} is no longer a desk.`,
    };
    throw new BookingError("SEAT_NOT_BOOKABLE", why[seat.status] ?? "That desk is not bookable.");
  }
}

/**
 * Who may change an existing booking: the person sitting there, the person who
 * made it, or an admin. A manager who booked for their team keeps the ability
 * to unbook it.
 */
export function assertMayMutateBooking(
  actor: User,
  booking: { occupantUserId: string; bookedByUserId: string },
): void {
  const mine =
    booking.occupantUserId === actor.id || booking.bookedByUserId === actor.id || actor.isAdmin;
  if (!mine) {
    throw new BookingError("FORBIDDEN", "That is not your booking to change.");
  }
}

export function assertAdmin(actor: User): void {
  if (!actor.isAdmin) {
    throw new BookingError("FORBIDDEN", "That is an administrator action.");
  }
}
