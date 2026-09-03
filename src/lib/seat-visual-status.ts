/**
 * The bridge between two vocabularies that are deliberately not the same.
 *
 * `seats.status` (4 values) is the desk's own state: is this a bookable desk,
 * somebody's allocated desk, out of service, gone.
 *
 * `SeatVisualStatus` (7 values) is what a particular person sees on the plan
 * for a particular date and slot. It folds in the booking and the viewer's
 * relationship to it — "booked" and "your booking" are the same desk state and
 * different pictures.
 *
 * Pure, so it is unit-testable and so the same function serves the 2D plan, the
 * list view, Phase 4's 3D view and Phase 5's analytics without any of them
 * re-deriving it slightly differently.
 */
import type { SeatVisualStatus } from "@/components/seat/seat-status";

/** Desk state, from `seats.status`. */
export type SeatDbStatus = "bookable" | "fixed" | "blocked" | "decommissioned";

/** Booking state, from `bookings.status`, for the date and slot on screen. */
export type BookingDbStatus =
  | "confirmed"
  | "checked_in"
  | "cancelled_by_user"
  | "auto_released"
  | "completed"
  | "completed_no_show";

export interface SeatOccupancy {
  /** The live booking for this seat, date and slot, if there is one. */
  bookingStatus: BookingDbStatus | null;
  /** Who the booking is for — the occupant, never the person who booked it. */
  occupantEmail: string | null;
  occupantName: string | null;
}

export interface SeatVisualInput extends SeatOccupancy {
  seatStatus: SeatDbStatus;
  /** Who is allocated this desk, when `seatStatus` is 'fixed'. */
  assignedName: string | null;
  /** The signed-in user, or null when nobody is. */
  viewerEmail: string | null;
}

/**
 * Only these booking states hold a seat. `cancelled_by_user`, `auto_released`
 * and `completed_no_show` all mean the seat is back in the pool — the row stays
 * because the history is the analytics, but the desk is free.
 */
const HOLDING: ReadonlySet<BookingDbStatus> = new Set([
  "confirmed",
  "checked_in",
  "completed",
]);

export function seatVisualStatus(input: SeatVisualInput): SeatVisualStatus {
  const { seatStatus, bookingStatus, occupantEmail, viewerEmail } = input;

  // The desk's own state wins over any booking on it. A desk taken out of
  // service must read as blocked even if a stale booking still points at it.
  if (seatStatus === "blocked" || seatStatus === "decommissioned") return "blocked";

  const held = bookingStatus !== null && HOLDING.has(bookingStatus);
  const yours =
    held && viewerEmail !== null && occupantEmail !== null && occupantEmail === viewerEmail;

  if (seatStatus === "fixed") {
    // A fixed desk stays visibly reserved to everyone else even when its owner
    // has checked in; only the owner sees it as theirs.
    return yours ? "your_booking" : "reserved_fixed";
  }

  if (held) {
    if (yours) return "your_booking";
    return bookingStatus === "checked_in" ? "checked_in" : "booked";
  }

  // A seat that was auto-released is available again, but saying so plainly
  // loses the fact that it came free late. The distinct status is what makes
  // the 2-hour rule visible on the plan.
  if (bookingStatus === "auto_released") return "auto_released";

  return "available";
}

/**
 * Whose name to show on a seat. Fixed desks name their allocated occupant even
 * with no booking — that is the point of a fixed desk.
 */
export function seatOccupantLabel(input: SeatVisualInput): string | null {
  if (input.bookingStatus !== null && HOLDING.has(input.bookingStatus)) {
    return input.occupantName;
  }
  if (input.seatStatus === "fixed") return input.assignedName;
  return null;
}

/** Does this seat count towards occupancy for the slot on screen? */
export function countsAsOccupied(status: SeatVisualStatus): boolean {
  return status === "booked" || status === "checked_in" || status === "your_booking";
}

/** Is this seat part of the bookable supply at all? */
export function countsAsCapacity(status: SeatVisualStatus): boolean {
  return status !== "blocked" && status !== "reserved_fixed";
}
