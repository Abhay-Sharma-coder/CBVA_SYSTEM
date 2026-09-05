import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { assignFixedSeat, changeSeatStatus } from "@/lib/admin/seat-lifecycle";
import { assertAdmin } from "@/lib/booking/authorise";
import { BookingError } from "@/lib/booking/errors";
import { dispatchSoon } from "@/lib/notifications/outbox";
import { schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    planX: z.number().finite().optional(),
    planY: z.number().finite().optional(),
    rotationDeg: z.number().int().min(0).max(359).optional(),
    status: z.enum(["bookable", "fixed", "blocked", "decommissioned"]).optional(),
    /**
     * Allocate this desk to somebody, or `null` to hand it back to the pool.
     *
     * Answering ASSUMPTIONS A2 — which physical desks are fixed — is a
     * five-minute edit here rather than a change to the seed. Setting it
     * implies `status: "fixed"`; clearing it implies `"bookable"`.
     */
    assignedUserId: z.string().uuid().nullable().optional(),
    /**
     * Confirms that the future bookings on this desk may be cancelled.
     *
     * Without it a status change that would strand somebody is refused, and the
     * 409 carries the list — see the rule in src/lib/admin/seat-lifecycle.ts
     * (edge cases 7 and 8).
     */
    force: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "send at least one field to change");

/**
 * Move, rotate or take a desk out of service.
 *
 * Guarded here rather than relying on the nav: the Admin item is hidden from
 * non-admins client-side, which is a courtesy, not a permission check.
 *
 * Every change writes an audit_log row. Furniture moves are exactly the kind of
 * edit somebody will need to explain six months later when the occupancy
 * numbers for a bay change shape.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ seatCode: string }> },
) {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);

    const { seatCode } = await context.params;
    const patch = await parseBody(request, patchSchema);

    const [before] = await ctx.db
      .select()
      .from(schema.seats)
      .where(eq(schema.seats.seatCode, seatCode))
      .limit(1);
    if (!before) throw new BookingError("SEAT_NOT_FOUND", `No seat ${seatCode}.`);

    // The status change goes through the lifecycle service, which is where the
    // "does anybody still have this desk booked?" rule lives. Geometry is a
    // plain update; taking a desk away from somebody is not.
    let cancelledBookings = 0;

    // Allocation is checked first, because it decides the status: assigning a
    // desk makes it fixed and clearing the allocation makes it bookable, so a
    // separate status change afterwards would just be a second chance to
    // disagree with itself.
    if (patch.assignedUserId !== undefined) {
      const result = await assignFixedSeat(ctx, seatCode, patch.assignedUserId, {
        force: patch.force,
      });
      cancelledBookings += result.cancelledBookingIds.length;
      if (result.cancelledBookingIds.length > 0) dispatchSoon({ db: ctx.db, clock: ctx.clock });
    } else if (patch.status !== undefined && patch.status !== before.status) {
      const result = await changeSeatStatus(ctx, seatCode, patch.status, { force: patch.force });
      cancelledBookings += result.cancelledBookingIds.length;
      if (result.cancelledBookingIds.length > 0) dispatchSoon({ db: ctx.db, clock: ctx.clock });
    }

    const geometry = {
      ...(patch.planX !== undefined ? { planX: patch.planX.toFixed(2) } : {}),
      ...(patch.planY !== undefined ? { planY: patch.planY.toFixed(2) } : {}),
      ...(patch.rotationDeg !== undefined ? { rotationDeg: patch.rotationDeg } : {}),
    };

    let after = before;
    if (Object.keys(geometry).length > 0) {
      const [updated] = await ctx.db
        .update(schema.seats)
        .set(geometry)
        .where(eq(schema.seats.seatCode, seatCode))
        .returning();
      after = updated ?? before;

      await ctx.db.insert(schema.auditLog).values({
        actorUserId: ctx.actor.id,
        entity: "seats",
        entityId: before.id,
        action: "update_geometry",
        before: { planX: before.planX, planY: before.planY, rotationDeg: before.rotationDeg },
        after: { planX: after.planX, planY: after.planY, rotationDeg: after.rotationDeg },
      });
    } else if (patch.status !== undefined || patch.assignedUserId !== undefined) {
      const [reloaded] = await ctx.db
        .select()
        .from(schema.seats)
        .where(eq(schema.seats.seatCode, seatCode))
        .limit(1);
      after = reloaded ?? before;
    }

    return NextResponse.json({
      seatCode,
      planX: Number(after.planX),
      planY: Number(after.planY),
      rotationDeg: after.rotationDeg,
      status: after.status,
      assignedUserId: after.assignedUserId,
      cancelledBookings,
    });
  });
}
