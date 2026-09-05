import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { handle, parseBody, routeContext } from "@/lib/api";
import { assertAdmin } from "@/lib/booking/authorise";
import { runAutoRelease } from "@/lib/booking/auto-release";
import { runScheduledJobs } from "@/lib/jobs/run-jobs";
import { outboxCounts } from "@/lib/notifications/outbox";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * What the scheduled jobs would do right now, and what they have been doing.
 *
 * The dry run is the point. A22 asked for one by name after an unbounded
 * auto-release settled 577 bookings in a single run: a job that can silently
 * rewrite thousands of rows of attendance history should be inspectable before
 * it is trusted, and "run it and see" is not inspection.
 */
export async function GET() {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);

    const settings = await getSettings(ctx.db);
    const now = ctx.clock.now();

    const [preview, outbox, recent] = await Promise.all([
      runAutoRelease({ db: ctx.db, clock: ctx.clock, dryRun: true }),
      outboxCounts(ctx.db),
      // The job's own audit trail. `actor_user_id is null` IS the filter for
      // "the job did this" — there is no other marker, and that is deliberate.
      ctx.db.execute(sql`
        select a.action, a.at, a.after
        from audit_log a
        where a.actor_user_id is null
        order by a.at desc
        limit 20`),
    ]);

    return NextResponse.json({
      now: now.toISOString(),
      settings: {
        autoReleaseMinutes: settings.autoReleaseMinutes,
        autoReleaseBatchCap: settings.autoReleaseBatchCap,
        autoReleaseHorizonDays: settings.autoReleaseHorizonDays,
        demoOffsetSeconds: settings.demoOffsetSeconds,
      },
      preview,
      outbox,
      recent: (recent.rows as Record<string, unknown>[]).map((r) => ({
        action: String(r.action),
        at: new Date(r.at as string).toISOString(),
        detail: r.after ?? null,
      })),
    });
  });
}

const postSchema = z.object({
  dryRun: z.boolean().optional(),
  /**
   * Deliberately settle a backlog the horizon is holding back.
   *
   * The horizon exists so a wrong clock cannot quietly rewrite old attendance
   * history; clearing what it skipped therefore has to be a decision somebody
   * makes, with a number in front of them, rather than a default.
   */
  settleBacklog: z.boolean().optional(),
  horizonDays: z.number().int().min(1).max(3650).optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);
    const body = await parseBody(request, postSchema).catch(() => ({}) as z.infer<typeof postSchema>);

    if (body.settleBacklog) {
      const result = await runAutoRelease({
        db: ctx.db,
        clock: ctx.clock,
        dryRun: body.dryRun ?? false,
        horizonDays: body.horizonDays ?? 3650,
      });
      return NextResponse.json({ settledBacklog: true, autoRelease: result });
    }

    const result = await runScheduledJobs({
      db: ctx.db,
      clock: ctx.clock,
      dryRun: body.dryRun ?? false,
    });
    return NextResponse.json(result);
  });
}
