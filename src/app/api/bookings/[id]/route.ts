import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { cancelBooking, editBooking } from "@/lib/booking/service";
import { dispatchSoon } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

const editSchema = z.object({
  seatCode: z.string().min(1).max(20),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.string().min(1).max(12),
  /**
   * The optimistic lock. The client echoes back the updated_at it last read; if
   * somebody else has touched the booking since, the edit is refused rather
   * than silently overwriting their change (edge case 13).
   */
  expectedUpdatedAt: z.string().min(1),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await context.params;
    const ctx = await routeContext();
    const body = await parseBody(request, editSchema);
    const result = await editBooking(ctx, { bookingId: id, ...body });
    dispatchSoon({ db: ctx.db, clock: ctx.clock });
    return NextResponse.json({
      id: result.booking.id,
      seatCode: result.seatCode,
      zone: result.zone,
      bay: result.bay,
      bookingDate: result.booking.bookingDate,
      slot: result.slot,
      status: result.booking.status,
      updatedAt: result.booking.updatedAt.toISOString(),
    });
  });
}

const cancelSchema = z
  .object({ expectedUpdatedAt: z.string().min(1).optional() })
  .optional()
  .default({});

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await context.params;
    const ctx = await routeContext();
    // A DELETE may legitimately carry no body; the lock is optional.
    const raw = await request.text();
    const body = cancelSchema.parse(raw ? JSON.parse(raw) : {});
    const booking = await cancelBooking(ctx, {
      bookingId: id,
      expectedUpdatedAt: body.expectedUpdatedAt,
    });
    dispatchSoon({ db: ctx.db, clock: ctx.clock });
    return NextResponse.json({ id: booking.id, status: booking.status });
  });
}
