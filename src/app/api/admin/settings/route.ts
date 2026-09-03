import { NextResponse } from "next/server";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { assertAdmin } from "@/lib/booking/authorise";
import { updateSettings } from "@/lib/admin/settings-service";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);
    return NextResponse.json(await getSettings(ctx.db));
  });
}

const patchSchema = z
  .object({
    /**
     * Validated properly by slotDefinitionsSchema inside the service, which
     * also refuses overlaps and drops. Loose here so the real message comes
     * from the one place that knows the rules.
     */
    slotDefinitions: z.unknown().optional(),
    bookingWindowDays: z.number().int().min(1).max(90).optional(),
    bookingWindowWorkingDays: z.number().int().min(1).max(60).optional(),
    cutoffMinutes: z.number().int().min(0).max(24 * 60).optional(),
    autoReleaseMinutes: z.number().int().min(5).max(12 * 60).optional(),
    checkInOpensMinutesBefore: z.number().int().min(0).max(6 * 60).optional(),
    officeHours: z
      .object({ start: z.string(), end: z.string() })
      .optional(),
    backfillHistory: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });

/**
 * Editing settings — and, when slot definitions move, backfilling every
 * booking's derived bounds in the same transaction. See ADR-021.
 */
export async function PATCH(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);
    const body = await parseBody(request, patchSchema);
    const result = await updateSettings(ctx, body);
    return NextResponse.json({
      ...(await getSettings(ctx.db)),
      backfilled: result.backfilled,
    });
  });
}
