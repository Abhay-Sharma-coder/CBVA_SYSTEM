/**
 * Badge check-in.
 *
 * There is no badge reader, and nobody has told us which vendor supplies one or
 * what its export looks like. So the flow is built against `CheckInSource` — a
 * subscriber that receives `BadgeEvent`s — and the demo pushes events through
 * the same subscription a real webhook will. The handler below is the part that
 * will not change when the hardware arrives.
 *
 * WHY BADGE CHECK-IN IS NOT ENOUGH ON ITS OWN, recorded here because it is the
 * reason the QR flow exists beside it: a door swipe proves somebody entered the
 * floor. It does not prove they used C3-04. Occupancy analytics built only on
 * swipes cannot distinguish a full floor from a half-full one, which is exactly
 * the question the partners are commissioning this product to answer. A badge
 * event therefore checks in whatever booking that person holds right now — a
 * reasonable inference, and recorded as `check_in_method = 'badge'` so the
 * analytics can weight it differently from a scan at the desk itself.
 */
import { and, eq, inArray } from "drizzle-orm";

import { checkIn as checkInSource } from "@/lib/adapters";
import { DemoCheckInSource } from "@/lib/adapters/demo";
import { checkInOpensAt } from "@/lib/booking/rules";
import { checkInBooking } from "@/lib/booking/service";
import type { Clock } from "@/lib/clock";
import { schema, type Db } from "@/lib/db";
import type { BadgeEvent, User } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";

export interface BadgeOutcome {
  matched: boolean;
  bookingId?: string;
  seatCode?: string;
  message: string;
}

/**
 * Turns one swipe into a check-in, if the person has a live booking.
 *
 * A swipe with no booking is not an error — plenty of people on the floor have
 * an allocated desk and never book one — so it is reported, not thrown.
 */
export async function handleBadgeEvent(
  options: { db: Db; clock: Clock },
  event: BadgeEvent,
): Promise<BadgeOutcome> {
  const { db, clock } = options;
  if (!event.userId) {
    return { matched: false, message: "That badge is not linked to anybody on the staff list." };
  }

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, event.userId)).limit(1);
  if (!user) {
    return { matched: false, message: "That badge is not linked to anybody on the staff list." };
  }

  const settings = await getSettings(db);
  const at = event.swipedAt;

  const candidates = await db
    .select({ booking: schema.bookings, seatCode: schema.seats.seatCode })
    .from(schema.bookings)
    .innerJoin(schema.seats, eq(schema.bookings.seatId, schema.seats.id))
    .where(
      and(
        eq(schema.bookings.occupantUserId, user.id),
        inArray(schema.bookings.status, ["confirmed", "checked_in"]),
      ),
    );

  const live = candidates.find(
    (c) =>
      at >= checkInOpensAt(c.booking.startsAt, settings.checkInOpensMinutesBefore) &&
      at < c.booking.endsAt,
  );

  if (!live) {
    return {
      matched: false,
      message: `${user.displayName} swiped in, but holds no desk booking for right now.`,
    };
  }
  if (live.booking.status === "checked_in") {
    return {
      matched: true,
      bookingId: live.booking.id,
      seatCode: live.seatCode,
      message: `${user.displayName} is already checked in to ${live.seatCode}.`,
    };
  }

  const result = await checkInBooking(
    { db, clock, actor: adminlike(user) },
    { bookingId: live.booking.id, userId: user.id, method: "badge" },
  );

  return {
    matched: true,
    bookingId: result.booking.id,
    seatCode: result.seatCode,
    message: `${user.displayName} checked in to ${result.seatCode} by badge.`,
  };
}

/**
 * A badge reader acts on the badge-holder's behalf, so the actor IS the person
 * who swiped. Marking them admin for the duration of this one call is how the
 * "you can only check in your own booking" guard is satisfied without giving a
 * machine event a fake user.
 */
function adminlike(user: User): User {
  return { ...user, isAdmin: true };
}

/**
 * Wires the handler to the adapter, once per process.
 *
 * The subscription is the production shape: a webhook will call the source's
 * emit path and this same handler will run. The demo's swipe button uses
 * `emitBadgeSwipe` below, which goes through the identical subscription rather
 * than calling the handler directly — otherwise the demo would be exercising a
 * code path production never takes.
 */
let subscribed = false;
const inFlight = new Map<string, Promise<BadgeOutcome>>();

export function registerBadgeCheckIn(options: { db: Db; clock: Clock }): void {
  if (subscribed) return;
  subscribed = true;
  checkInSource().subscribe((event) => {
    inFlight.set(event.id, handleBadgeEvent(options, event));
  });
}

/**
 * Pushes an event through the subscription and waits for the handler.
 *
 * `instanceof` rather than a read of APP_MODE: this asks whether the live
 * source can have events pushed into it, which is a property of the
 * implementation, not of the environment. The only place APP_MODE is branched
 * on stays src/lib/adapters/index.ts.
 */
export async function emitBadgeSwipe(
  options: { db: Db; clock: Clock },
  event: BadgeEvent,
): Promise<BadgeOutcome> {
  registerBadgeCheckIn(options);
  const source = checkInSource();
  if (!(source instanceof DemoCheckInSource)) {
    return {
      matched: false,
      message: "The live check-in source is driven by the badge reader, not by this button.",
    };
  }
  source.emit(event);
  const pending = inFlight.get(event.id);
  inFlight.delete(event.id);
  return (
    pending ??
    Promise.resolve({ matched: false, message: "Nothing is listening for badge events." })
  );
}
