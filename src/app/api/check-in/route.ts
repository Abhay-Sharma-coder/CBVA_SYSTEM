import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { checkInBooking } from "@/lib/booking/service";

export const dynamic = "force-dynamic";

/**
 * Check-in, from any source that has a session behind it.
 *
 * The QR sticker on the desk sends `seatCode`; the app sends `bookingId`. Both
 * land on the same service function, so there is one definition of what a valid
 * check-in is regardless of how somebody arrived at it.
 */
const schema = z
  .object({
    bookingId: z.uuid().optional(),
    seatCode: z.string().min(1).max(20).optional(),
    method: z.enum(["qr", "app", "admin"]).default("app"),
  })
  .refine((v) => Boolean(v.bookingId ?? v.seatCode), {
    message: "Provide a bookingId or a seatCode.",
  });

export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    const body = await parseBody(request, schema);
    const result = await checkInBooking(ctx, {
      bookingId: body.bookingId,
      seatCode: body.seatCode,
      method: body.method,
    });
    return NextResponse.json({
      id: result.booking.id,
      seatCode: result.seatCode,
      slot: result.slot,
      status: result.booking.status,
      checkedInAt: result.booking.checkedInAt?.toISOString() ?? null,
      alreadyCheckedIn: result.alreadyCheckedIn,
    });
  });
}
