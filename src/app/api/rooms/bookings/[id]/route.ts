import { NextResponse } from "next/server";

import { handle, routeContext } from "@/lib/api";
import { cancelRoomBooking } from "@/lib/rooms/service";
import { dispatchSoon } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await context.params;
    const ctx = await routeContext();
    const booking = await cancelRoomBooking(ctx, id);
    dispatchSoon({ db: ctx.db, clock: ctx.clock });
    return NextResponse.json({ id: booking.id, status: booking.status });
  });
}
