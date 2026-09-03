import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/adapters";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    planX: z.number().finite().optional(),
    planY: z.number().finite().optional(),
    rotationDeg: z.number().int().min(0).max(359).optional(),
    status: z.enum(["bookable", "fixed", "blocked", "decommissioned"]).optional(),
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
  const viewer = await auth().currentUser();
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const { seatCode } = await context.params;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const database = db();
  const [before] = await database
    .select()
    .from(schema.seats)
    .where(eq(schema.seats.seatCode, seatCode))
    .limit(1);

  if (!before) {
    return NextResponse.json({ error: `No seat ${seatCode}.` }, { status: 404 });
  }

  const patch = parsed.data;
  const [after] = await database
    .update(schema.seats)
    .set({
      ...(patch.planX !== undefined ? { planX: patch.planX.toFixed(2) } : {}),
      ...(patch.planY !== undefined ? { planY: patch.planY.toFixed(2) } : {}),
      ...(patch.rotationDeg !== undefined ? { rotationDeg: patch.rotationDeg } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    })
    .where(eq(schema.seats.seatCode, seatCode))
    .returning();

  await database.insert(schema.auditLog).values({
    actorUserId: viewer.id,
    entity: "seats",
    entityId: before.id,
    action: "update_geometry",
    before: {
      planX: before.planX,
      planY: before.planY,
      rotationDeg: before.rotationDeg,
      status: before.status,
    },
    after: {
      planX: after?.planX,
      planY: after?.planY,
      rotationDeg: after?.rotationDeg,
      status: after?.status,
    },
  });

  return NextResponse.json({
    seatCode,
    planX: Number(after?.planX),
    planY: Number(after?.planY),
    rotationDeg: after?.rotationDeg,
    status: after?.status,
  });
}
