import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { handle, routeContext } from "@/lib/api";
import { assertAdmin } from "@/lib/booking/authorise";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().max(80).nullable().optional(),
  grade: z.string().max(24).nullable().optional(),
  team: z.string().max(80).nullable().optional(),
  active: z.enum(["all", "active", "inactive"]).default("all"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/**
 * The staff roster, for administration.
 *
 * Carries each person's allocated desk and their live booking count, because
 * the two questions an admin actually has are "does this person have a desk"
 * and "will changing them break anything" — and answering the second one after
 * the fact, with a constraint violation, is not administration.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);

    const url = new URL(request.url);
    const q = querySchema.parse({
      q: url.searchParams.get("q"),
      grade: url.searchParams.get("grade"),
      team: url.searchParams.get("team"),
      active: url.searchParams.get("active") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const filters = [sql`true`];
    if (q.q) {
      const like = `%${q.q.toLowerCase()}%`;
      filters.push(sql`(lower(u.display_name) like ${like} or lower(u.email) like ${like})`);
    }
    if (q.grade) filters.push(sql`u.grade::text = ${q.grade}`);
    if (q.team) filters.push(sql`u.team = ${q.team}`);
    if (q.active === "active") filters.push(sql`u.is_active`);
    if (q.active === "inactive") filters.push(sql`not u.is_active`);

    const now = ctx.clock.now();

    const rows = await ctx.db.execute(sql`
      select
        u.id, u.display_name, u.email, u.grade::text as grade, u.team,
        u.seat_mode::text as seat_mode, u.is_admin, u.is_active,
        u.share_attendance,
        s.seat_code as fixed_seat_code,
        (select count(*)::int from bookings b
          where b.occupant_user_id = u.id
            and b.status in ('confirmed','checked_in')
            and b.ends_at > ${now}::timestamptz) as upcoming_bookings
      from users u
      left join seats s on s.id = u.fixed_seat_id
      where ${sql.join(filters, sql` and `)}
      order by u.display_name
      limit ${q.limit}`);

    const teams = await ctx.db.execute(
      sql`select distinct team from users where team is not null order by team`,
    );

    return NextResponse.json({
      teams: (teams.rows as Record<string, unknown>[]).map((r) => String(r.team)),
      users: (rows.rows as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        displayName: String(r.display_name),
        email: String(r.email),
        grade: String(r.grade),
        team: r.team ? String(r.team) : null,
        seatMode: String(r.seat_mode),
        isAdmin: Boolean(r.is_admin),
        isActive: Boolean(r.is_active),
        shareAttendance: Boolean(r.share_attendance),
        fixedSeatCode: r.fixed_seat_code ? String(r.fixed_seat_code) : null,
        upcomingBookings: Number(r.upcoming_bookings ?? 0),
      })),
    });
  });
}
