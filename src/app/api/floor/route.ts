import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/adapters";
import { db, schema } from "@/lib/db";
import {
  countsAsCapacity,
  countsAsOccupied,
  seatOccupantLabel,
  seatVisualStatus,
  type BookingDbStatus,
  type SeatDbStatus,
} from "@/lib/seat-visual-status";
import type { FloorPlanPayload, FloorPlanSeat } from "@/components/floor-plan/types";
import { seatAnchor } from "@/lib/floorplan";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be yyyy-MM-dd"),
  slot: z.enum(["AM", "PM"]),
});

/**
 * Every seat on the floor, resolved to a visual status for one date, one slot
 * and one viewer.
 *
 * Only booking rows that actually hold a seat are joined in — cancelled,
 * auto-released and no-show rows stay in the table because the history is the
 * analytics, but they must not make a desk look taken.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    date: url.searchParams.get("date"),
    slot: url.searchParams.get("slot"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const { date, slot } = parsed.data;

  const viewer = await auth().currentUser();
  const database = db();

  const seatRows = await database
    .select({
      seatCode: schema.seats.seatCode,
      bay: schema.seats.bay,
      zoneCode: schema.zones.code,
      planX: schema.seats.planX,
      planY: schema.seats.planY,
      rotationDeg: schema.seats.rotationDeg,
      seatType: schema.seats.seatType,
      status: schema.seats.status,
      assignedName: schema.users.displayName,
    })
    .from(schema.seats)
    .innerJoin(schema.zones, eq(schema.seats.zoneId, schema.zones.id))
    .leftJoin(schema.users, eq(schema.seats.assignedUserId, schema.users.id));

  const bookingRows = await database
    .select({
      seatCode: schema.seats.seatCode,
      status: schema.bookings.status,
      occupantEmail: schema.users.email,
      occupantName: schema.users.displayName,
    })
    .from(schema.bookings)
    .innerJoin(schema.seats, eq(schema.bookings.seatId, schema.seats.id))
    .innerJoin(schema.users, eq(schema.bookings.occupantUserId, schema.users.id))
    .where(
      and(
        eq(schema.bookings.bookingDate, date),
        eq(schema.bookings.slot, slot),
        // The partial index behind seat_slot_unique covers confirmed and
        // checked_in; completed is included so a past day still reads as
        // occupied rather than emptying out behind you.
        inArray(schema.bookings.status, ["confirmed", "checked_in", "completed"]),
      ),
    );

  const bookingBySeat = new Map(bookingRows.map((b) => [b.seatCode, b] as const));

  let occupied = 0;
  let capacity = 0;

  const seats: FloorPlanSeat[] = seatRows.map((row) => {
    const booking = bookingBySeat.get(row.seatCode);
    const input = {
      seatStatus: row.status as SeatDbStatus,
      assignedName: row.assignedName,
      bookingStatus: (booking?.status ?? null) as BookingDbStatus | null,
      occupantEmail: booking?.occupantEmail ?? null,
      occupantName: booking?.occupantName ?? null,
      viewerEmail: viewer?.email ?? null,
    };
    const status = seatVisualStatus(input);
    if (countsAsOccupied(status)) occupied += 1;
    if (countsAsCapacity(status)) capacity += 1;

    return {
      seatCode: row.seatCode,
      bay: row.bay,
      zone: row.zoneCode as FloorPlanSeat["zone"],
      // numeric columns arrive as strings from pg — deliberate, not a bug.
      planX: Number(row.planX),
      planY: Number(row.planY),
      rotationDeg: row.rotationDeg,
      seatType: row.seatType,
      seatStatus: input.seatStatus,
      status,
      occupantName: seatOccupantLabel(input),
      // Where the position came from: the drawing, an interpolation, or
      // somebody dragging it in the editor. The editor badges the weak ones.
      anchorSource: seatAnchor(row.seatCode)?.source ?? "manual",
    };
  });

  seats.sort((a, b) => a.seatCode.localeCompare(b.seatCode));

  const payload: FloorPlanPayload = {
    date,
    slot,
    seats,
    occupied,
    capacity,
    viewerEmail: viewer?.email ?? null,
  };
  return NextResponse.json(payload);
}
