import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { canBookOnBehalf } from "@/lib/booking/authorise";
import { myBookings } from "@/lib/booking/queries";
import { createBooking } from "@/lib/booking/service";
import { dispatchSoon } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

/** Everything that concerns me: what I am sitting in, and what I booked for others. */
export async function GET() {
  return handle(async () => {
    const ctx = await routeContext();
    const { upcoming, past } = await myBookings(ctx.db, ctx.actor.id, ctx.clock.now());
    return NextResponse.json({
      now: ctx.clock.now().toISOString(),
      canBookOnBehalf: canBookOnBehalf(ctx.actor),
      upcoming,
      past,
    });
  });
}

const createSchema = z.object({
  seatCode: z.string().min(1).max(20),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "bookingDate must be yyyy-MM-dd"),
  slot: z.string().min(1).max(12),
  /** Omit to book for yourself. */
  occupantUserId: z.uuid().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    const body = await parseBody(request, createSchema);
    const result = await createBooking(ctx, body);

    // The booking is committed. Sending is best-effort from here and its
    // failures are the queue's problem, never this request's.
    dispatchSoon({ db: ctx.db, clock: ctx.clock });

    return NextResponse.json(
      {
        id: result.booking.id,
        seatCode: result.seatCode,
        zone: result.zone,
        bay: result.bay,
        bookingDate: result.booking.bookingDate,
        slot: result.slot,
        status: result.booking.status,
        occupantName: result.occupantName,
        updatedAt: result.booking.updatedAt.toISOString(),
      },
      { status: 201 },
    );
  });
}
