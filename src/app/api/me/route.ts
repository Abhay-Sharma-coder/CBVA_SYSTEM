import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The signed-in person's own preferences. Nothing here is admin-gated. */
export async function GET() {
  return handle(async () => {
    const ctx = await routeContext();
    return NextResponse.json({
      id: ctx.actor.id,
      displayName: ctx.actor.displayName,
      email: ctx.actor.email,
      grade: ctx.actor.grade,
      team: ctx.actor.team,
      seatMode: ctx.actor.seatMode,
      isAdmin: ctx.actor.isAdmin,
      shareAttendance: ctx.actor.shareAttendance,
    });
  });
}

const patchSchema = z.object({
  shareAttendance: z.boolean(),
});

/**
 * The coworker-visibility opt-out.
 *
 * Audited like any other change to a user row: this is a privacy choice, and
 * "who turned my name off and when" is a question somebody will eventually ask.
 * Turning it off hides the NAME and never the desk, so no occupancy figure
 * moves when somebody opts out — which is the property that makes the opt-out
 * safe to offer at all.
 */
export async function PATCH(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    const body = await parseBody(request, patchSchema);

    await ctx.db
      .update(schema.users)
      .set({ shareAttendance: body.shareAttendance })
      .where(eq(schema.users.id, ctx.actor.id));

    await writeAudit(ctx.db, {
      actorUserId: ctx.actor.id,
      entity: "users",
      entityId: ctx.actor.id,
      action: "update_user",
      before: { shareAttendance: ctx.actor.shareAttendance },
      after: { shareAttendance: body.shareAttendance },
    });

    return NextResponse.json({ shareAttendance: body.shareAttendance });
  });
}
