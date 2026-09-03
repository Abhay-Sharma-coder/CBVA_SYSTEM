import { NextResponse } from "next/server";

import { handle, routeContext } from "@/lib/api";
import { assertAdmin } from "@/lib/booking/authorise";
import { BookingError } from "@/lib/booking/errors";
import { dispatchNotifications, requeueNotification } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

/** Puts a failed message back in the queue and tries it immediately. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await context.params;
    const ctx = await routeContext();
    assertAdmin(ctx.actor);

    const requeued = await requeueNotification(ctx.db, id);
    if (!requeued) {
      throw new BookingError(
        "BOOKING_NOT_ACTIVE",
        "That message is not in a failed state, so there is nothing to retry.",
      );
    }
    const result = await dispatchNotifications({ db: ctx.db, clock: ctx.clock, limit: 5 });
    return NextResponse.json({ requeued: true, ...result });
  });
}
