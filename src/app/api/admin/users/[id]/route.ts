import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { setUserActive } from "@/lib/admin/seat-lifecycle";
import { dispatchSoon } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

const schema = z.object({ isActive: z.boolean() });

/**
 * Deactivating somebody cancels their future desk bookings and tells everybody
 * affected (edge case 12). A desk held by an account that no longer exists is
 * capacity the floor has lost for nothing.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await context.params;
    const ctx = await routeContext();
    const body = await parseBody(request, schema);
    const result = await setUserActive(ctx, id, body.isActive);
    dispatchSoon({ db: ctx.db, clock: ctx.clock });
    return NextResponse.json(result);
  });
}
