import Link from "next/link";
import { count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getClock } from "@/lib/clock";
import { auth } from "@/lib/adapters";
import { APP_TIMEZONE } from "@/lib/config";
import { Card, CardBody, CardHeader, CardTitle, Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { GRADE_LABEL } from "@/lib/seed-data/inventory";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Phase 1 landing page. Deliberately thin — it exists to prove the shell, the
 * adapters, the clock and the seed are all wired to each other. The numbers are
 * real reads against the seeded database, not placeholders.
 */
export default async function HomePage() {
  const clock = await getClock();
  const now = clock.now();
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(now);

  const user = await auth().currentUser();

  const [inventory] = await db()
    .select({
      total: count(),
      bookable: sql<number>`count(*) filter (where ${schema.seats.status} = 'bookable')`,
      fixed: sql<number>`count(*) filter (where ${schema.seats.status} = 'fixed')`,
      blocked: sql<number>`count(*) filter (where ${schema.seats.status} = 'blocked')`,
    })
    .from(schema.seats);

  const [todayStats] = await db()
    .select({
      booked: sql<number>`count(distinct ${schema.bookings.seatId}) filter (where ${schema.bookings.status} in ('confirmed','checked_in','completed'))`,
      people: sql<number>`count(distinct ${schema.bookings.occupantUserId}) filter (where ${schema.bookings.status} in ('confirmed','checked_in','completed'))`,
      checkedIn: sql<number>`count(distinct ${schema.bookings.seatId}) filter (where ${schema.bookings.status} = 'checked_in')`,
    })
    .from(schema.bookings)
    .where(eq(schema.bookings.bookingDate, todayIso));

  const [headcount] = await db()
    .select({
      total: count(),
      bookableStaff: sql<number>`count(*) filter (where ${schema.users.seatMode} = 'bookable')`,
    })
    .from(schema.users);

  const bookable = Number(inventory?.bookable ?? 0);
  const bookedToday = Number(todayStats?.booked ?? 0);
  const utilisation = bookable > 0 ? Math.round((bookedToday / bookable) * 100) : 0;

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs tracking-wide text-ink-subtle uppercase">
          {dateFormatter.format(now)}
        </p>
        <h1 className="mt-1 text-3xl text-ink">
          {user ? `Good day, ${user.displayName.split(" ")[0]}.` : "Workspace"}
        </h1>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          {user ? (
            <>
              You are signed in as{" "}
              <strong className="font-medium text-ink">
                {GRADE_LABEL[user.grade]}
              </strong>
              {user.team ? `, ${user.team}` : null}.{" "}
              {user.seatMode === "fixed"
                ? "You have an allocated seat, so you do not need to book."
                : "You book a seat for each day you come in."}
            </>
          ) : (
            "No one is signed in. Pick a person from the role switcher."
          )}
        </p>
      </section>

      <section aria-labelledby="today-heading">
        <h2 id="today-heading" className="sr-only">
          Today at a Glance
        </h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hairline bg-hairline lg:grid-cols-4">
          <Stat
            label="Seats Occupied Today"
            value={String(bookedToday)}
            hint={`of ${bookable} bookable`}
          />
          {/* The one gold-accented number on the page: the metric partners
              actually care about. */}
          <Stat label="Utilisation" value={`${utilisation}%`} accent />
          <Stat
            label="Checked In Now"
            value={String(Number(todayStats?.checkedIn ?? 0))}
            hint="via badge"
          />
          <Stat
            label="Headcount"
            value={String(Number(headcount?.total ?? 0))}
            hint={`${Number(headcount?.bookableStaff ?? 0)} must book`}
          />
        </dl>
      </section>

      <section className="grid gap-6 lg:grid-cols-3" aria-labelledby="phase-heading">
        <h2 id="phase-heading" className="sr-only">
          Build Status
        </h2>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>What Is Built</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm text-ink-muted">
            <p className="max-w-prose">
              Phase 1 is the foundation: schema, database-enforced booking
              constraints, the clock service, the integration adapters, and a
              seeded floor of {Number(inventory?.total ?? 0)} desks with eight
              weeks of booking history behind it.
            </p>
            <ul className="space-y-1.5">
              <PhaseRow phase="1" label="Foundation" state="done" />
              <PhaseRow phase="2" label="CAD Pipeline & 2D Floor Plan" state="next" />
              <PhaseRow phase="3" label="Booking Engine, Rooms, Auto-Release" state="todo" />
              <PhaseRow phase="4" label="3D Floor Plan" state="todo" />
              <PhaseRow phase="5" label="Admin Analytics & Deploy" state="todo" />
            </ul>
            <div className="pt-2">
              <Button asChild variant="secondary" size="sm">
                <Link href="/styleguide">Open the Style Guide</Link>
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Floor 4 Inventory</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="space-y-2 text-sm">
              <InventoryRow label="Total Desks" value={Number(inventory?.total ?? 0)} />
              <InventoryRow label="Bookable" value={bookable} />
              <InventoryRow label="Fixed Allocation" value={Number(inventory?.fixed ?? 0)} />
              <InventoryRow label="Blocked" value={Number(inventory?.blocked ?? 0)} />
            </dl>
            <p className="mt-4 border-t border-hairline pt-3 text-xs text-ink-subtle">
              Seat positions are on a temporary grid. Phase 2 replaces them with
              coordinates extracted from the CAD drawing.
            </p>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-xs tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-2">
        <span
          className={
            accent
              ? "border-b-2 border-gold pb-0.5 text-2xl leading-none font-semibold tabular text-ink"
              : "text-2xl leading-none font-semibold tabular text-ink"
          }
        >
          {value}
        </span>
        {hint ? <span className="text-xs text-ink-subtle">{hint}</span> : null}
      </dd>
    </div>
  );
}

function InventoryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular font-medium text-ink">{value}</dd>
    </div>
  );
}

function PhaseRow({
  phase,
  label,
  state,
}: {
  phase: string;
  label: string;
  state: "done" | "next" | "todo";
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="seat-code w-4 text-xs text-ink-subtle">{phase}</span>
      <span className={state === "todo" ? "text-ink-subtle" : "text-ink"}>{label}</span>
      {state === "done" ? (
        <Badge variant="positive">Complete</Badge>
      ) : state === "next" ? (
        <Badge variant="navy">Next</Badge>
      ) : null}
    </li>
  );
}
