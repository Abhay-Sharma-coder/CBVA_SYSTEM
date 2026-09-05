import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { handle, routeContext } from "@/lib/api";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.string().min(1).max(12).nullable().optional(),
});

/**
 * Who is in on a given day, and where they are sitting.
 *
 * WHY THIS EXISTS. Every product review in this category says the same thing:
 * the main reason people open a desk-booking app is to find out whether their
 * team is in. The adoption risk on this engagement is that low seat contention
 * means nobody bothers booking, which would make the occupancy data worthless —
 * and this is the cheapest thing that gives somebody a reason to open the app
 * on a day they were not going to book anything.
 *
 * PRIVACY. Signed-in only (routeContext refuses otherwise), and anybody who has
 * opted out is counted but not named. The count is deliberately still right:
 * "22 people in, 3 of whom have not shared their desk" is honest and useful,
 * whereas quietly dropping them would make the roster disagree with the floor
 * plan for no visible reason.
 *
 * Fixed-desk holders appear too, and they are the majority of the people you
 * would want to find — a partner does not book, they simply have a desk. The
 * roster would be misleading without them.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    const url = new URL(request.url);

    const q = querySchema.parse({
      date: url.searchParams.get("date") ?? ctx.clock.now().toISOString().slice(0, 10),
      slot: url.searchParams.get("slot"),
    });

    const settings = await getSettings(ctx.db);
    const slots = q.slot ? [q.slot] : settings.slotDefinitions.map((d) => d.key);

    const rows = await ctx.db.execute(sql`
      select
        u.id, u.display_name, u.team, u.grade::text as grade,
        u.share_attendance,
        s.seat_code, s.bay, z.code as zone,
        b.slot, b.status::text as status,
        (b.checked_in_at is not null) as checked_in,
        false as fixed_desk
      from bookings b
      join users u on u.id = b.occupant_user_id
      join seats s on s.id = b.seat_id
      join zones z on z.id = s.zone_id
      where b.booking_date = ${q.date}::date
        and b.slot = any(${sql.param(slots)}::text[])
        and b.status in ('confirmed','checked_in','completed')

      union all

      -- People with an allocated desk make no booking, so they would be absent
      -- from a roster built only from the bookings table — and they are exactly the
      -- people somebody is usually looking for. Excluded when they have handed
      -- the desk back for that day, because then they are not in.
      select
        u.id, u.display_name, u.team, u.grade::text as grade,
        u.share_attendance,
        s.seat_code, s.bay, z.code as zone,
        null as slot, 'fixed' as status,
        false as checked_in,
        true as fixed_desk
      from seats s
      join users u on u.id = s.assigned_user_id
      join zones z on z.id = s.zone_id
      where s.status = 'fixed'
        and u.is_active
        and not exists (
          select 1 from seat_releases r
           where r.seat_id = s.id
             and r.release_date = ${q.date}::date
             and r.revoked_at is null)

      order by 2`);

    interface Row {
      id: string;
      displayName: string;
      team: string | null;
      grade: string;
      seatCode: string | null;
      bay: string | null;
      zone: string | null;
      slots: string[];
      checkedIn: boolean;
      fixedDesk: boolean;
      /** False when they have opted out; name and desk are then withheld. */
      shared: boolean;
    }

    // One row per person, not per booking: somebody in for AM and PM is one
    // person in the office, and a roster that lists them twice is a roster
    // nobody trusts.
    const byPerson = new Map<string, Row>();
    let hidden = 0;

    for (const raw of rows.rows as Record<string, unknown>[]) {
      const id = String(raw.id);
      const shared = Boolean(raw.share_attendance) || id === ctx.actor.id;
      const existing = byPerson.get(id);

      if (existing) {
        if (raw.slot) existing.slots.push(String(raw.slot));
        existing.checkedIn = existing.checkedIn || Boolean(raw.checked_in);
        continue;
      }

      if (!shared) hidden += 1;

      byPerson.set(id, {
        id,
        displayName: shared ? String(raw.display_name) : "A colleague",
        team: shared ? ((raw.team as string) ?? null) : null,
        grade: String(raw.grade),
        seatCode: shared ? ((raw.seat_code as string) ?? null) : null,
        bay: shared ? ((raw.bay as string) ?? null) : null,
        zone: shared ? ((raw.zone as string) ?? null) : null,
        slots: raw.slot ? [String(raw.slot)] : [],
        checkedIn: Boolean(raw.checked_in),
        fixedDesk: Boolean(raw.fixed_desk),
        shared,
      });
    }

    const people = [...byPerson.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );

    return NextResponse.json({
      date: q.date,
      slot: q.slot ?? null,
      total: people.length,
      hidden,
      checkedIn: people.filter((p) => p.checkedIn).length,
      people,
    });
  });
}
