import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { cancelSeries } from "@/lib/booking/series";
import { dispatchSoon } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({
  /** Occurrences from this date forward are dropped. Defaults to today. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /**
   * Also cancel the bookings already materialised from `from` onwards.
   *
   * Two genuinely different intentions, so it is a choice rather than a
   * default: "stop repeating" leaves the desks I already have, "cancel it all"
   * gives them back. Guessing either way is wrong half the time.
   */
  cancelFutureOccurrences: z.boolean().optional(),
});

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const ctx = await routeContext();
    const { id } = await params;
    const body = await parseBody(request, deleteSchema);
    const result = await cancelSeries(ctx, {
      seriesId: id,
      from: body.from ?? ctx.clock.now().toISOString().slice(0, 10),
      cancelFutureOccurrences: body.cancelFutureOccurrences,
    });
    if (result.cancelledBookingIds.length > 0) {
      dispatchSoon({ db: ctx.db, clock: ctx.clock });
    }
    return NextResponse.json(result);
  });
}
