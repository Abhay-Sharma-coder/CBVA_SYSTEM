import { NextResponse } from "next/server";

import { handle, routeContext } from "@/lib/api";
import { canBookOnBehalf } from "@/lib/booking/authorise";
import { bookablePeople } from "@/lib/booking/queries";
import { BookingError } from "@/lib/booking/errors";

export const dynamic = "force-dynamic";

/**
 * The on-behalf picker's list: bookable-grade, active staff only.
 *
 * Gated on the same rule as the write, so somebody who cannot book for a
 * colleague cannot enumerate the roster either.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    if (!canBookOnBehalf(ctx.actor)) {
      throw new BookingError(
        "NOT_PERMITTED_ON_BEHALF",
        "Booking for a colleague is available to managers and above, and to admin staff.",
      );
    }
    const q = new URL(request.url).searchParams.get("q");
    const people = await bookablePeople(ctx.db, q && q.trim() ? q.trim() : null);
    return NextResponse.json({ people });
  });
}
