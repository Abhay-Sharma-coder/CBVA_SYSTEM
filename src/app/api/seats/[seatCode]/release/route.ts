import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { releaseFixedSeat, revokeSeatRelease } from "@/lib/booking/seat-release";
import { dispatchSoon } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(30),
  /** Omit for the whole day — every slot in the current definitions. */
  slots: z.array(z.string().min(1).max(12)).min(1).max(24).optional(),
  note: z.string().max(200).optional(),
});

/** Hand an allocated desk back to the pool. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ seatCode: string }> },
) {
  return handle(async () => {
    const ctx = await routeContext();
    const { seatCode } = await params;
    const body = await parseBody(request, postSchema);
    const releases = await releaseFixedSeat(ctx, { seatCode, ...body });
    return NextResponse.json({ releases }, { status: 201 });
  });
}

const deleteSchema = z.object({
  releaseId: z.string().uuid(),
  /**
   * Admin only, and refused for anybody else inside the service. Cancels
   * whoever took the desk — which is why it is an explicit flag rather than a
   * silent behaviour of the ordinary path.
   */
  force: z.boolean().optional(),
  reason: z.string().max(200).optional(),
});

/** Reclaim it. Refused with the colleague's name if somebody booked it. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ seatCode: string }> },
) {
  return handle(async () => {
    const ctx = await routeContext();
    await params;
    const body = await parseBody(request, deleteSchema);
    const result = await revokeSeatRelease(ctx, body);
    // A forced revoke cancels somebody's booking, and they should hear about it
    // now rather than on the next cron tick.
    if (result.cancelledBookingId) dispatchSoon({ db: ctx.db, clock: ctx.clock });
    return NextResponse.json(result);
  });
}
