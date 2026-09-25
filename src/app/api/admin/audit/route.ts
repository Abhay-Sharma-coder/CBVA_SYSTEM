import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { handle, routeContext } from "@/lib/api";
import { assertAdmin } from "@/lib/booking/authorise";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  entity: z.string().max(32).nullable().optional(),
  action: z.string().max(32).nullable().optional(),
  actor: z.string().uuid().nullable().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * The audit log, finally readable.
 *
 * `src/lib/audit.ts` has been writing this table since Phase 3 and nothing has
 * ever read it — which meant the record existed but the accountability did not.
 * Every booking, cancellation, seat status change, settings edit and job
 * transition is in here, including the ones with a null actor, which are the
 * job's own work.
 *
 * Paginated rather than capped, because the interesting question is usually
 * "what happened around the time this went wrong", and a hard cap of 200 rows
 * answers that only for the last twenty minutes.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);

    const url = new URL(request.url);
    const q = querySchema.parse({
      entity: url.searchParams.get("entity"),
      action: url.searchParams.get("action"),
      actor: url.searchParams.get("actor"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const filters = [sql`true`];
    if (q.entity) filters.push(sql`a.entity = ${q.entity}`);
    if (q.action) filters.push(sql`a.action = ${q.action}`);
    if (q.actor) filters.push(sql`a.actor_user_id = ${q.actor}::uuid`);
    if (q.from) filters.push(sql`a.at >= ${q.from}::date`);
    // Inclusive of the whole end day, which is what a person means by "to".
    if (q.to) filters.push(sql`a.at < (${q.to}::date + interval '1 day')`);
    const where = sql.join(filters, sql` and `);

    const [rows, counts, vocab] = await Promise.all([
      ctx.db.execute(sql`
        select
          a.id, a.entity, a.entity_id, a.action, a.before, a.after, a.at,
          a.actor_user_id,
          u.display_name as actor_name,
          u.email as actor_email
        from audit_log a
        left join users u on u.id = a.actor_user_id
        where ${where}
        order by a.at desc, a.id desc
        limit ${q.limit} offset ${q.offset}`),
      ctx.db.execute(sql`select count(*)::int as n from audit_log a where ${where}`),
      // The vocabulary that is actually present, so the filter dropdowns cannot
      // offer a value that returns nothing.
      ctx.db.execute(sql`
        select 'entity' as kind, entity as value from audit_log group by entity
        union all
        select 'action' as kind, action as value from audit_log group by action
        order by 1, 2`),
    ]);

    return NextResponse.json({
      total: Number((counts.rows[0] as { n: number } | undefined)?.n ?? 0),
      limit: q.limit,
      offset: q.offset,
      entities: (vocab.rows as Record<string, unknown>[])
        .filter((r) => r.kind === "entity")
        .map((r) => String(r.value)),
      actions: (vocab.rows as Record<string, unknown>[])
        .filter((r) => r.kind === "action")
        .map((r) => String(r.value)),
      rows: (rows.rows as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        entity: String(r.entity),
        entityId: r.entity_id ? String(r.entity_id) : null,
        action: String(r.action),
        before: r.before ?? null,
        after: r.after ?? null,
        at: new Date(r.at as string).toISOString(),
        // A null actor is the JOB, not an unknown person. Named explicitly so
        // the viewer never shows a blank cell for the most common writer here.
        actorName: r.actor_name ? String(r.actor_name) : null,
        actorEmail: r.actor_email ? String(r.actor_email) : null,
      })),
    });
  });
}
