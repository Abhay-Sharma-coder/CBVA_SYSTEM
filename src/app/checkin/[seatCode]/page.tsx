import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";

import { CheckInConfirm } from "@/app/checkin/[seatCode]/confirm";
import { auth } from "@/lib/adapters";
import { checkInOpensAt } from "@/lib/booking/rules";
import { getClock } from "@/lib/clock";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { Card, CardBody, StatusMessage } from "@/components/ui/primitives";
import { SeatSwatchWithGlyph } from "@/components/seat/seat-swatch";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ seatCode: string }>;
}): Promise<Metadata> {
  const { seatCode } = await params;
  return { title: `Check in — ${decodeURIComponent(seatCode)}` };
}

/**
 * The QR target: what somebody sees after scanning the sticker on a desk.
 *
 * THE ARGUMENT FOR THIS SCREEN EXISTING. A door swipe proves somebody entered
 * the floor; it does not prove they used C3-04. Occupancy analytics built on
 * swipes alone cannot tell a full floor from a half-full one — which is the
 * question the partners are commissioning this product to answer — and it makes
 * the whole thing depend on an access-control vendor whose export format nobody
 * has seen. A sticker on the desk removes both problems.
 *
 * The URL is not a secret and is not treated as one: it is printed on a desk in
 * an open-plan office, so identity comes from the session and the booking, not
 * from possession of the link. What it proves is "this person, who holds this
 * desk for this slot, said they are at it" — which is a materially stronger
 * claim than a turnstile can make, and honestly weaker than physical presence.
 * See ASSUMPTIONS A19.
 *
 * A GET must not mutate, so this page only resolves the situation and offers a
 * button. Everything it can find is spelled out: not signed in, no booking,
 * wrong desk, too early, slot over, already checked in.
 */
export default async function Page({ params }: { params: Promise<{ seatCode: string }> }) {
  const { seatCode: raw } = await params;
  const seatCode = decodeURIComponent(raw);

  const viewer = await auth().currentUser();
  const clock = await getClock();
  const database = db();
  const settings = await getSettings(database);
  const now = clock.now();

  const [seat] = await database
    .select({
      seatCode: schema.seats.seatCode,
      bay: schema.seats.bay,
      status: schema.seats.status,
      zoneCode: schema.zones.code,
      zoneName: schema.zones.displayName,
    })
    .from(schema.seats)
    .innerJoin(schema.zones, eq(schema.seats.zoneId, schema.zones.id))
    .where(eq(schema.seats.seatCode, seatCode))
    .limit(1);

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-md space-y-5">
      <header>
        <p className="text-xs tracking-wide text-ink-subtle uppercase">Desk check-in</p>
        <h1 className="mt-1 text-2xl">
          <span className="seat-code">{seatCode}</span>
        </h1>
        {seat ? (
          <p className="mt-1 text-sm text-ink-muted">
            {seat.zoneName} · Zone {seat.zoneCode}, bay {seat.bay}
          </p>
        ) : null}
      </header>
      {children}
    </div>
  );

  if (!seat) {
    return shell(
      <StatusMessage tone="danger">
        There is no desk {seatCode} on this floor. Check the code on the sticker.
      </StatusMessage>,
    );
  }

  if (!viewer) {
    return shell(
      <StatusMessage tone="caution">
        Sign in and scan again — a check-in has to be attached to a person.
      </StatusMessage>,
    );
  }

  const candidates = await database
    .select({
      id: schema.bookings.id,
      status: schema.bookings.status,
      slot: schema.bookings.slot,
      startsAt: schema.bookings.startsAt,
      endsAt: schema.bookings.endsAt,
      checkedInAt: schema.bookings.checkedInAt,
    })
    .from(schema.bookings)
    .innerJoin(schema.seats, eq(schema.bookings.seatId, schema.seats.id))
    .where(
      and(
        eq(schema.seats.seatCode, seatCode),
        eq(schema.bookings.occupantUserId, viewer.id),
        inArray(schema.bookings.status, ["confirmed", "checked_in", "auto_released"]),
      ),
    );

  const opensAt = (startsAt: Date) => checkInOpensAt(startsAt, settings.checkInOpensMinutesBefore);
  const live = candidates.filter((c) => now >= opensAt(c.startsAt) && now < c.endsAt);
  const booking =
    live.find((c) => c.status === "confirmed") ??
    live.find((c) => c.status === "checked_in") ??
    live[0];

  if (!booking) {
    // The most likely reason somebody scans a desk they have no booking for is
    // that they sat down at the wrong one, so say which desk this is and point
    // them at the plan rather than just refusing.
    const upcoming = candidates.find((c) => now < opensAt(c.startsAt));
    return shell(
      <>
        <Card>
          <CardBody className="flex items-center gap-4">
            <SeatSwatchWithGlyph status="available" code={seat.seatCode} />
            <p className="text-sm text-ink-muted">
              {upcoming
                ? `Your booking for this desk starts at ${formatInTimeZone(
                    upcoming.startsAt,
                    settings.timezone,
                    "HH:mm",
                  )}. Check-in opens ${settings.checkInOpensMinutesBefore} minutes before that.`
                : `You do not have a booking for ${seatCode} right now.`}
            </p>
          </CardBody>
        </Card>
        <a
          href="/floor"
          className="inline-block text-sm text-navy underline underline-offset-4 hover:text-ink"
        >
          Open the floor plan
        </a>
      </>,
    );
  }

  if (booking.status === "auto_released") {
    return shell(
      <StatusMessage tone="caution">
        This desk was released at{" "}
        {formatInTimeZone(booking.startsAt, settings.timezone, "HH:mm")} plus{" "}
        {settings.autoReleaseMinutes} minutes because nobody had checked in, so it is back in the
        pool. Book another desk from the floor plan.
      </StatusMessage>,
    );
  }

  const slot = settings.slotDefinitions.find((d) => d.key === booking.slot);

  return shell(
    <CheckInConfirm
      seatCode={seatCode}
      bookingId={booking.id}
      slotLabel={slot ? `${slot.label} · ${slot.start}–${slot.end}` : booking.slot}
      alreadyCheckedIn={booking.status === "checked_in"}
      checkedInAtLabel={
        booking.checkedInAt
          ? formatInTimeZone(booking.checkedInAt, settings.timezone, "HH:mm")
          : null
      }
      occupantName={viewer.displayName}
    />,
  );
}
