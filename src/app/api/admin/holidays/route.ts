import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { assertAdmin } from "@/lib/booking/authorise";
import { BookingError } from "@/lib/booking/errors";
import { schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The public holiday list.
 *
 * ASSUMPTIONS A6: we invented 39 national and Maharashtra holidays across
 * 2026–2027, and the lunar-calendar dates vary by observance. The booking
 * engine treats these as non-working days, so a wrong date means staff CANNOT
 * BOOK A DAY THEY ARE EXPECTED IN — which is the most user-visible way this
 * product can be wrong. It was seed-only until now; replacing it with CBVA's
 * official circular is a screen, not a deploy.
 */
export async function GET() {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);
    const rows = await ctx.db
      .select()
      .from(schema.holidays)
      .orderBy(asc(schema.holidays.holidayDate));
    return NextResponse.json({ holidays: rows });
  });
}

const postSchema = z.object({
  holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().min(1).max(80),
});

export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);
    const body = await parseBody(request, postSchema);

    const [row] = await ctx.db
      .insert(schema.holidays)
      .values(body)
      .onConflictDoUpdate({
        target: schema.holidays.holidayDate,
        set: { name: body.name },
      })
      .returning();

    await writeAudit(ctx.db, {
      actorUserId: ctx.actor.id,
      entity: "settings",
      entityId: null,
      action: "update_settings",
      after: { holiday: body },
    });

    return NextResponse.json(row, { status: 201 });
  });
}

const deleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);
    const { id } = await parseBody(request, deleteSchema);

    const [row] = await ctx.db
      .delete(schema.holidays)
      .where(eq(schema.holidays.id, id))
      .returning();
    if (!row) throw new BookingError("BOOKING_NOT_FOUND", "That holiday is already gone.");

    await writeAudit(ctx.db, {
      actorUserId: ctx.actor.id,
      entity: "settings",
      entityId: null,
      action: "update_settings",
      before: { holiday: { holidayDate: row.holidayDate, name: row.name } },
      after: { holiday: null },
    });

    return NextResponse.json({ id });
  });
}
