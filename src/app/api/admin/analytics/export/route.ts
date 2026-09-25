import { handle, routeContext } from "@/lib/api";
import { assertAdmin } from "@/lib/booking/authorise";
import { csvResponse, exportFilename, toCsv, type CsvColumn } from "@/lib/analytics/csv";
import { filterParts, parseFilters, workingDaysBetween } from "@/lib/analytics/filters";
import {
  bookingRows,
  capacityByDaySlot,
  occupancyByDaySlot,
  seatUtilisation,
  type BookingExportRow,
  type DaySlotRow,
  type SeatUtilisationRow,
} from "@/lib/analytics/queries";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * The three exports, over exactly the filters on screen.
 *
 * They all go through `parseFilters`, the same parser the analytics route uses,
 * so a downloaded CSV can never disagree with the chart it came from. That is a
 * property of there being one parser rather than a rule three handlers have to
 * remember.
 *
 * Every export carries its own provenance columns — the range, and for
 * occupancy the capacity it was measured against — because these files get
 * mailed around and opened six months later with no memory of what was on
 * screen at the time.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);

    const url = new URL(request.url);
    const now = ctx.clock.now();
    const f = parseFilters(url, now.toISOString().slice(0, 10));
    const kind = url.searchParams.get("kind") ?? "bookings";
    const settings = await getSettings(ctx.db);

    if (kind === "occupancy") {
      const days = await occupancyByDaySlot(ctx.db, f, now);
      // Capacity only for the days that actually have rows — a day nobody
      // booked has no line in this export, so its capacity is not needed.
      const capacity = await capacityByDaySlot(
        ctx.db,
        [...new Set(days.map((d) => d.date))],
        settings.slotDefinitions,
        f,
      );
      const capBy = new Map(capacity.map((c) => [`${c.date}|${c.slot}`, c]));

      const columns: CsvColumn<DaySlotRow>[] = [
        { header: "Date", value: (r) => r.date },
        { header: "Weekday", value: (r) => WEEKDAYS[r.weekday] },
        { header: "Slot", value: (r) => r.slot },
        { header: "Desks claimed", value: (r) => r.desksClaimed },
        { header: "Claims (incl. rebooked)", value: (r) => r.claims },
        { header: "People", value: (r) => r.peopleClaiming },
        { header: "Desks attended", value: (r) => r.desksAttended },
        { header: "QR verified", value: (r) => r.deskVerified },
        { header: "Badge only", value: (r) => r.badgeOnly },
        { header: "No shows", value: (r) => r.noShows },
        { header: "Auto released", value: (r) => r.autoReleased },
        { header: "Cancellations", value: (r) => r.cancellations },
        { header: "Seat-hours consumed", value: (r) => r.seatHours },
        { header: "Seat-hours if no-show were free", value: (r) => r.seatHoursNoShowFree },
        {
          header: "Bookable pool",
          value: (r) => capBy.get(`${r.date}|${r.slot}`)?.pool ?? "",
        },
        {
          header: "Capacity (incl. released fixed)",
          value: (r) => capBy.get(`${r.date}|${r.slot}`)?.capacity ?? "",
        },
        {
          header: "Utilisation %",
          value: (r) => {
            const cap = capBy.get(`${r.date}|${r.slot}`)?.capacity ?? 0;
            return cap > 0 ? ((r.desksClaimed / cap) * 100).toFixed(1) : "";
          },
        },
      ];

      return csvResponse(
        toCsv(days, columns),
        exportFilename("occupancy", f.from, f.to, filterParts(f)),
      );
    }

    if (kind === "utilisation") {
      const rows = await seatUtilisation(
        ctx.db,
        f,
        now,
        settings.slotDefinitions,
        workingDaysBetween(f.from, f.to),
      );

      const columns: CsvColumn<SeatUtilisationRow>[] = [
        { header: "Seat", value: (r) => r.seatCode },
        { header: "Bay", value: (r) => r.bay },
        { header: "Zone", value: (r) => r.zone },
        { header: "Desk status", value: (r) => r.seatStatus },
        { header: "Slots claimed", value: (r) => r.slotsClaimed },
        { header: "Slots attended", value: (r) => r.slotsAttended },
        { header: "Slots available", value: (r) => r.slotsAvailable },
        { header: "Utilisation %", value: (r) => r.utilisationPct },
        { header: "Seat-hours", value: (r) => r.seatHours },
      ];

      return csvResponse(
        toCsv(rows, columns),
        exportFilename("seat-utilisation", f.from, f.to, filterParts(f)),
      );
    }

    /* -------------------------------------------------------- bookings */

    const rows = await bookingRows(ctx.db, f, now);
    const columns: CsvColumn<BookingExportRow>[] = [
      { header: "Date", value: (r) => r.bookingDate },
      { header: "Slot", value: (r) => r.slot },
      { header: "Seat", value: (r) => r.seatCode },
      { header: "Bay", value: (r) => r.bay },
      { header: "Zone", value: (r) => r.zone },
      { header: "Occupant", value: (r) => r.occupantName },
      { header: "Email", value: (r) => r.occupantEmail },
      { header: "Grade", value: (r) => r.grade },
      { header: "Team", value: (r) => r.team },
      { header: "Status", value: (r) => r.status },
      { header: "Booked by", value: (r) => r.source },
      { header: "Checked in at", value: (r) => r.checkedInAt },
      { header: "Check-in method", value: (r) => r.checkInMethod },
      { header: "Released at", value: (r) => r.releasedAt },
      { header: "Cancelled at", value: (r) => r.cancelledAt },
      { header: "Seat-hours", value: (r) => r.seatHours },
      { header: "On a released fixed desk", value: (r) => r.fromReleasedFixedSeat },
      { header: "Recurring", value: (r) => r.recurring },
    ];

    return csvResponse(
      toCsv(rows, columns),
      exportFilename("bookings", f.from, f.to, filterParts(f)),
    );
  });
}

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
