import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { setUserActive } from "@/lib/admin/seat-lifecycle";
import { writeAudit } from "@/lib/audit";
import { assertAdmin } from "@/lib/booking/authorise";
import { BookingError } from "@/lib/booking/errors";
import { schema } from "@/lib/db";
import { dispatchSoon } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

const schema_ = z.object({
  isActive: z.boolean().optional(),
  grade: z
    .enum(["partner", "director", "manager", "assistant_manager", "article", "admin_staff"])
    .optional(),
  seatMode: z.enum(["fixed", "bookable"]).optional(),
  team: z.string().max(80).nullable().optional(),
  isAdmin: z.boolean().optional(),
  shareAttendance: z.boolean().optional(),
});

/**
 * Editing a person.
 *
 * `isActive` still goes through `setUserActive`, which cancels their future
 * bookings and notifies everybody affected (edge case 12) — a desk held by an
 * account that no longer exists is capacity the floor has lost for nothing. The
 * other fields are a plain update with an audit row.
 *
 * Grade and seatMode are here because answering ASSUMPTIONS A1 — how the 54 CAs
 * split between Manager and Assistant Manager — must not be a code change. That
 * split is the denominator of every number in the product, and when the HR list
 * finally arrives somebody should be able to type it in.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await context.params;
    const ctx = await routeContext();
    assertAdmin(ctx.actor);
    const body = await parseBody(request, schema_);

    const [before] = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    if (!before) throw new BookingError("USER_NOT_FOUND", "That person is not on the staff list.");

    // Removing your own admin flag locks you out of the screen you are standing
    // on, and there may be no other admin to put it back.
    if (body.isAdmin === false && id === ctx.actor.id) {
      throw new BookingError(
        "FORBIDDEN",
        "You cannot remove your own administrator access. Ask another administrator to do it.",
      );
    }

    const fields = {
      ...(body.grade !== undefined ? { grade: body.grade } : {}),
      ...(body.seatMode !== undefined ? { seatMode: body.seatMode } : {}),
      ...(body.team !== undefined ? { team: body.team } : {}),
      ...(body.isAdmin !== undefined ? { isAdmin: body.isAdmin } : {}),
      ...(body.shareAttendance !== undefined
        ? { shareAttendance: body.shareAttendance }
        : {}),
    };

    if (Object.keys(fields).length > 0) {
      await ctx.db.update(schema.users).set(fields).where(eq(schema.users.id, id));
      await writeAudit(ctx.db, {
        actorUserId: ctx.actor.id,
        entity: "users",
        entityId: id,
        action: "update_user",
        before: {
          grade: before.grade,
          seatMode: before.seatMode,
          team: before.team,
          isAdmin: before.isAdmin,
          shareAttendance: before.shareAttendance,
        },
        after: fields,
      });
    }

    let cancelledBookingIds: string[] = [];
    if (body.isActive !== undefined && body.isActive !== before.isActive) {
      const result = await setUserActive(ctx, id, body.isActive);
      cancelledBookingIds = result.cancelledBookingIds;
      dispatchSoon({ db: ctx.db, clock: ctx.clock });
    }

    const [after] = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);

    return NextResponse.json({
      id,
      isActive: after!.isActive,
      grade: after!.grade,
      seatMode: after!.seatMode,
      team: after!.team,
      isAdmin: after!.isAdmin,
      shareAttendance: after!.shareAttendance,
      cancelledBookingIds,
    });
  });
}
