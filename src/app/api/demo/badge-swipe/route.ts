import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { BookingError } from "@/lib/booking/errors";
import { emitBadgeSwipe } from "@/lib/booking/badge";
import { serverEnv } from "@/lib/config";
import { schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const schemaIn = z.object({ userId: z.uuid().optional(), email: z.email().optional() });

/**
 * The demo's stand-in for the badge reader nobody has given us yet.
 *
 * It writes a real `badge_events` row and pushes it through the real
 * `CheckInSource` subscription, so the code that turns a swipe into a check-in
 * is the same code a vendor webhook will drive. Only the thing pressing the
 * button is fake.
 *
 * 403 in production, following the same carve-out as the role switcher and the
 * clock control: demo affordances are refused rather than quietly present.
 */
export async function POST(request: Request) {
  return handle(async () => {
    if (serverEnv().appMode === "production") {
      throw new BookingError("FORBIDDEN", "Simulated badge swipes are a demo-mode affordance.");
    }
    const ctx = await routeContext();
    const body = await parseBody(request, schemaIn);

    const targetId = body.userId ?? ctx.actor.id;
    if (targetId !== ctx.actor.id && !ctx.actor.isAdmin) {
      throw new BookingError("FORBIDDEN", "Only an administrator can swipe for somebody else.");
    }

    const swipedAt = ctx.clock.now();
    const [event] = await ctx.db
      .insert(schema.badgeEvents)
      .values({
        userId: targetId,
        swipedAt,
        readerId: "demo-door-4f",
        raw: { source: "demo-panel", pressedBy: ctx.actor.email },
      })
      .returning();

    const outcome = await emitBadgeSwipe({ db: ctx.db, clock: ctx.clock }, event!);
    return NextResponse.json({ swipedAt: swipedAt.toISOString(), ...outcome });
  });
}
