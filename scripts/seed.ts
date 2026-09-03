/**
 * CBVA Workspace seed.
 *
 * IDEMPOTENT BY CONSTRUCTION. Every row's primary key is a UUID v5 of its
 * natural key under a fixed namespace, and every insert is onConflictDoUpdate.
 * Run it twice and the row counts do not move.
 *
 * DETERMINISTIC. All randomness comes from a fixed-seed mulberry32, so two runs
 * produce identical bookings and the analytics numbers do not drift between
 * demos.
 *
 * Realism matters here more than it looks: analytics IS the product, and a
 * screen built on three rows of data looks broken to a partner.
 *
 *   npm run seed
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { v5 as uuidv5 } from "uuid";
import { addDays, format, getDay, subDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";

import * as schema from "../src/lib/db/schema";
import { makeRng, type Rng } from "../src/lib/seed-data/rng";
import { HOLIDAYS } from "../src/lib/seed-data/holidays";
import { floorplanSeatAnchors } from "../src/lib/floorplan";
import { FIRST_NAMES, LAST_NAMES } from "../src/lib/seed-data/names";
import {
  ADMIN_TEAMS,
  BAYS,
  FIXED_SEAT_ALLOCATION,
  HEADCOUNT,
  MEETING_ROOMS,
  TEAMS,
  ZONES,
  seatCodes,
  seatTypeForBay,
} from "../src/lib/seed-data/inventory";
import { DEFAULT_SLOT_DEFINITIONS } from "../src/lib/slots";

/** Fixed namespace: same natural key always yields the same uuid. */
const NS = "6f0a1c2e-8b3d-4e5a-9f10-2b7c4d5e6a8b";
const id = (...parts: (string | number)[]) => uuidv5(parts.join("|"), NS);

const TZ = "Asia/Kolkata";
const RNG_SEED = 20260903;

const HISTORY_WEEKS = 8;
const FORWARD_WORKING_DAYS = 5;

/** Share of bookable staff who book on a given weekday. Mon/Fri are lighter —
 *  the WFH day clusters at the ends of the week, which is the whole reason
 *  CBVA cannot forecast capacity. */
const DAY_ATTENDANCE: Record<number, number> = {
  1: 0.76, // Monday
  2: 0.9, // Tuesday
  3: 0.89, // Wednesday
  4: 0.87, // Thursday
  5: 0.78, // Friday
};

const NO_SHOW_RATE = 0.12;
const CANCEL_RATE = 0.08;
const ON_BEHALF_RATE = 0.04;
const BAY_AFFINITY = 0.65;
const FULL_DAY_RATE = 0.7;
const AM_ONLY_SPLIT = 0.55;

type Db = NodePgDatabase<typeof schema>;

/* ------------------------------------------------------------------ helpers */

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const holidaySet = new Set(HOLIDAYS.map((h) => h.date));

function isWorkingDay(d: Date): boolean {
  const dow = getDay(d);
  return dow >= 1 && dow <= 5 && !holidaySet.has(iso(d));
}

function slotBounds(date: string, slot: "AM" | "PM") {
  const def = DEFAULT_SLOT_DEFINITIONS[slot];
  return {
    startsAt: fromZonedTime(`${date}T${def.start}:00`, TZ),
    endsAt: fromZonedTime(`${date}T${def.end}:00`, TZ),
  };
}

/**
 * "Today" for the seed. The seed sits outside business logic — it is the thing
 * that establishes the timeline the Clock later reads against — so this is one
 * of the four sanctioned places wall time is read directly.
 */
function today(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/* --------------------------------------------------------------- the people */

interface SeededUser {
  id: string;
  email: string;
  displayName: string;
  grade: schema.Grade;
  team: string;
  seatMode: "fixed" | "bookable";
  isAdmin: boolean;
}

function buildUsers(rng: Rng): SeededUser[] {
  const users: SeededUser[] = [];
  const usedEmails = new Set<string>();
  let n = 0;

  for (const bracket of HEADCOUNT) {
    for (let i = 0; i < bracket.count; i++) {
      const first = FIRST_NAMES[(n * 7 + i * 13) % FIRST_NAMES.length]!;
      const last = LAST_NAMES[(n * 11 + i * 5) % LAST_NAMES.length]!;
      let email = `${first}.${last}`.toLowerCase() + "@cbva.in";
      let dedupe = 2;
      while (usedEmails.has(email)) {
        email = `${first}.${last}${dedupe++}`.toLowerCase() + "@cbva.in";
      }
      usedEmails.add(email);

      const team =
        bracket.grade === "admin_staff"
          ? rng.pick(ADMIN_TEAMS)
          : rng.pick(TEAMS);

      users.push({
        id: id("user", email),
        email,
        displayName: `${first} ${last}`,
        grade: bracket.grade,
        team,
        seatMode: bracket.seatMode,
        // Admins: the IT/HR staff plus one partner, so the demo can switch into
        // an admin view from either direction.
        isAdmin: bracket.grade === "admin_staff" || (bracket.grade === "partner" && i === 0),
      });
      n++;
    }
  }
  return users;
}

/* ---------------------------------------------------------------- the seats */

interface SeededSeat {
  id: string;
  seatCode: string;
  bay: string;
  zone: string;
  seatType: "workstation" | "passage" | "foldable" | "cabin";
  planX: string;
  planY: string;
  rotationDeg: number;
}

/**
 * Seat geometry comes from the CAD extraction, not from this file.
 *
 * `src/data/floorplan/seats.json` is written by `npm run build:floorplan` from
 * the architect's drawing and is the source of truth for where a desk is. The
 * editor at /admin/floor-plan writes corrections back into it, which is why
 * re-seeding is safe: it re-reads the same corrected file rather than
 * flattening the floor back onto a grid.
 *
 * The reconciliation against BAYS is deliberate and strict. If the extraction
 * and the bay schedule ever disagree, seeding stops rather than quietly
 * producing a floor that is missing desks.
 */
function buildSeats(): SeededSeat[] {
  const anchors = new Map(
    floorplanSeatAnchors.seats.map((a) => [a.seatCode, a] as const),
  );

  const seats: SeededSeat[] = [];
  const missing: string[] = [];

  for (const bay of BAYS) {
    for (const code of seatCodes(bay)) {
      const anchor = anchors.get(code);
      if (!anchor) {
        missing.push(code);
        continue;
      }
      seats.push({
        id: id("seat", code),
        seatCode: code,
        bay: bay.bay,
        zone: bay.zone,
        seatType: seatTypeForBay(bay.bay),
        planX: anchor.planX.toFixed(2),
        planY: anchor.planY.toFixed(2),
        rotationDeg: anchor.rotationDeg,
      });
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `src/data/floorplan/seats.json has no anchor for ${missing.length} seat(s): ` +
        `${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}. ` +
        "Run: npm run build:floorplan",
    );
  }
  const extra = floorplanSeatAnchors.seats.length - seats.length;
  if (extra !== 0) {
    throw new Error(
      `seats.json carries ${floorplanSeatAnchors.seats.length} anchors but the bay ` +
        `schedule expects ${seats.length}. The drawing and inventory.ts have drifted.`,
    );
  }
  return seats;
}

/* ------------------------------------------------------------------- upsert */

async function chunked<T>(rows: T[], size: number, fn: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}

/* --------------------------------------------------------------------- main */

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");

  if (process.env.APP_MODE === "production") {
    throw new Error(
      "refusing to seed with APP_MODE=production — this script rebuilds all booking data",
    );
  }

  const pool = new Pool({ connectionString: url, max: 4 });
  const db: Db = drizzle(pool, { schema });
  const rng = makeRng(RNG_SEED);

  console.log("seeding CBVA Workspace …");

  /* ---- rebuild the generated booking history ----
     Reference data (users, seats, rooms, holidays, settings) is upserted on its
     natural key and survives. Bookings are regenerated wholesale, because the
     deterministic stream shifts whenever the generator changes and stale rows
     from an earlier stream would then collide with the new ones — as the room
     exclusion constraint correctly points out when they do. Deleting first
     keeps a re-run safe both after a code change and when run twice unchanged. */
  await db.delete(schema.roomBookings);
  await db.delete(schema.bookings);

  /* ---- settings (singleton) ---- */
  await db
    .insert(schema.settings)
    .values({
      id: id("settings"),
      bookingWindowDays: 14,
      slotDefinitions: DEFAULT_SLOT_DEFINITIONS,
      autoReleaseMinutes: 120,
      cutoffMinutes: 60,
      timezone: TZ,
      demoOffsetSeconds: 0,
    })
    .onConflictDoUpdate({
      target: schema.settings.id,
      set: {
        bookingWindowDays: 14,
        slotDefinitions: DEFAULT_SLOT_DEFINITIONS,
        autoReleaseMinutes: 120,
        cutoffMinutes: 60,
        timezone: TZ,
      },
    });

  /* ---- holidays ---- */
  await db
    .insert(schema.holidays)
    .values(
      HOLIDAYS.map((h) => ({
        id: id("holiday", h.date),
        holidayDate: h.date,
        name: h.name,
      })),
    )
    .onConflictDoUpdate({
      target: schema.holidays.holidayDate,
      set: { name: sql`excluded.name` },
    });

  /* ---- floor + zones ---- */
  const floorId = id("floor", "4");
  await db
    .insert(schema.floors)
    .values({
      id: floorId,
      number: 4,
      name: "Floor 4",
      planAssetKey: "assets/cad/floor4-walls.svg",
      isActive: true,
    })
    .onConflictDoUpdate({
      target: schema.floors.id,
      set: { name: "Floor 4", planAssetKey: "assets/cad/floor4-walls.svg" },
    });

  await db
    .insert(schema.zones)
    .values(
      ZONES.map((z) => ({
        id: id("zone", "4", z.code),
        floorId,
        code: z.code,
        displayName: z.displayName,
        sortOrder: z.sortOrder,
      })),
    )
    .onConflictDoUpdate({
      target: [schema.zones.floorId, schema.zones.code],
      set: { displayName: sql`excluded.display_name` },
    });

  /* ---- users ---- */
  const users = buildUsers(rng);
  await chunked(users, 100, async (batch) => {
    await db
      .insert(schema.users)
      .values(
        batch.map((u) => ({
          id: u.id,
          email: u.email,
          displayName: u.displayName,
          grade: u.grade,
          team: u.team,
          seatMode: u.seatMode,
          isAdmin: u.isAdmin,
          isActive: true,
        })),
      )
      .onConflictDoUpdate({
        target: schema.users.email,
        set: {
          displayName: sql`excluded.display_name`,
          grade: sql`excluded.grade`,
          team: sql`excluded.team`,
          seatMode: sql`excluded.seat_mode`,
          isAdmin: sql`excluded.is_admin`,
        },
      });
  });

  /* ---- seats ---- */
  const seats = buildSeats();
  const zoneIdFor = (zone: string) => id("zone", "4", zone);
  const activeFrom = "2025-01-01";

  await chunked(seats, 100, async (batch) => {
    await db
      .insert(schema.seats)
      .values(
        batch.map((s) => ({
          id: s.id,
          zoneId: zoneIdFor(s.zone),
          floorId,
          seatCode: s.seatCode,
          bay: s.bay,
          planX: s.planX,
          planY: s.planY,
          rotationDeg: s.rotationDeg,
          seatType: s.seatType,
          status: "bookable" as const,
          amenities:
            s.seatType === "cabin"
              ? { monitor: true, drawers: true, phone: true }
              : s.seatType === "passage"
                ? { monitor: false, drawers: false }
                : { monitor: true, drawers: true },
          activeFrom,
        })),
      )
      .onConflictDoUpdate({
        target: schema.seats.seatCode,
        set: {
          zoneId: sql`excluded.zone_id`,
          bay: sql`excluded.bay`,
          planX: sql`excluded.plan_x`,
          planY: sql`excluded.plan_y`,
          rotationDeg: sql`excluded.rotation_deg`,
          seatType: sql`excluded.seat_type`,
          amenities: sql`excluded.amenities`,
        },
      });
  });

  /* ---- fixed seat allocation ----
     Pairs the 47 fixed-grade people with the 47 allocated desks, sets
     seats.status='fixed' + assigned_user_id and users.fixed_seat_id. */
  const byGrade = new Map<schema.Grade, SeededUser[]>();
  for (const u of users) {
    if (u.seatMode !== "fixed") continue;
    const list = byGrade.get(u.grade) ?? [];
    list.push(u);
    byGrade.set(u.grade, list);
  }

  let fixedPairs = 0;
  for (const alloc of FIXED_SEAT_ALLOCATION) {
    const pool = byGrade.get(alloc.grade) ?? [];
    if (pool.length !== alloc.codes.length) {
      throw new Error(
        `fixed allocation mismatch for ${alloc.grade}: ${pool.length} people, ${alloc.codes.length} seats`,
      );
    }
    for (let i = 0; i < alloc.codes.length; i++) {
      const code = alloc.codes[i]!;
      const user = pool[i]!;
      const seatId = id("seat", code);
      await db
        .update(schema.seats)
        .set({ status: "fixed", assignedUserId: user.id })
        .where(sql`${schema.seats.seatCode} = ${code}`);
      await db
        .update(schema.users)
        .set({ fixedSeatId: seatId })
        .where(sql`${schema.users.id} = ${user.id}`);
      fixedPairs++;
    }
  }

  // One blocked desk, so the status vocabulary has a live example and the
  // analytics have to cope with capacity that is not the full seat count.
  await db
    .update(schema.seats)
    .set({ status: "blocked" })
    .where(sql`${schema.seats.seatCode} = 'PD-18'`);

  /* ---- meeting rooms ---- */
  await db
    .insert(schema.meetingRooms)
    .values(
      MEETING_ROOMS.map((r) => ({
        id: id("room", r.name),
        floorId,
        name: r.name,
        capacity: r.capacity,
        amenities: r.amenities,
        outlookResourceEmail: null,
        isBookable: true,
      })),
    )
    .onConflictDoUpdate({
      target: schema.meetingRooms.name,
      set: {
        capacity: sql`excluded.capacity`,
        amenities: sql`excluded.amenities`,
      },
    });

  /* ---- bookings ---- */
  const bookableUsers = users.filter((u) => u.seatMode === "bookable");
  const bookableSeats = seats.filter(
    (s) =>
      !FIXED_SEAT_ALLOCATION.some((a) => a.codes.includes(s.seatCode)) &&
      s.seatCode !== "PD-18",
  );
  const bayGroups = new Map<string, SeededSeat[]>();
  for (const s of bookableSeats) {
    const list = bayGroups.get(s.bay) ?? [];
    list.push(s);
    bayGroups.set(s.bay, list);
  }
  const bookableBays = [...bayGroups.keys()];

  // Each person has a bay they gravitate back to, the way real people do.
  const affinity = new Map<string, string>();
  for (const u of bookableUsers) affinity.set(u.id, rng.pick(bookableBays));

  const t0 = today();
  const dates: string[] = [];
  for (let i = HISTORY_WEEKS * 7; i >= 1; i--) {
    const d = subDays(t0, i);
    if (isWorkingDay(d)) dates.push(iso(d));
  }
  const pastDates = [...dates];
  if (isWorkingDay(t0)) dates.push(iso(t0));
  let ahead = 1;
  let added = 0;
  while (added < FORWARD_WORKING_DAYS) {
    const d = addDays(t0, ahead++);
    if (isWorkingDay(d)) {
      dates.push(iso(d));
      added++;
    }
  }
  const futureCutoff = iso(t0);

  type BookingRow = typeof schema.bookings.$inferInsert;
  const bookingRows: BookingRow[] = [];

  for (const date of dates) {
    const dow = getDay(new Date(`${date}T00:00:00Z`));
    const attendance = DAY_ATTENDANCE[dow] ?? 0.8;
    const isPast = pastDates.includes(date);
    const isFuture = date > futureCutoff;

    // Who is in today.
    const attendees = rng
      .shuffle([...bookableUsers])
      .slice(0, Math.round(bookableUsers.length * attendance));

    // Track what is taken so the seed never violates seat_slot_unique. The
    // constraint would reject it anyway — that is the point of it — but the
    // seed is not the place to demonstrate that.
    const taken = new Set<string>();

    for (const user of attendees) {
      const preferred = affinity.get(user.id)!;
      const bay = rng.chance(BAY_AFFINITY) ? preferred : rng.pick(bookableBays);

      const slots: Array<"AM" | "PM"> = rng.chance(FULL_DAY_RATE)
        ? ["AM", "PM"]
        : rng.chance(AM_ONLY_SPLIT)
          ? ["AM"]
          : ["PM"];

      // One seat for the whole visit — nobody moves desks at lunch.
      // Try the bay they gravitate to first; if it is full, take anything free,
      // which is exactly what a person does when their usual desk has gone.
      const free = (s: SeededSeat) =>
        slots.every((slot) => !taken.has(`${s.seatCode}|${slot}`));
      const seat =
        rng.shuffle([...(bayGroups.get(bay) ?? [])]).find(free) ??
        rng.shuffle([...bookableSeats]).find(free);
      if (!seat) continue;

      // Outcome is decided once per visit, not per slot, so a no-show does not
      // check in for the afternoon of a morning they never turned up to.
      const roll = rng.next();
      const cancelled = roll < CANCEL_RATE;
      const noShow = !cancelled && roll < CANCEL_RATE + NO_SHOW_RATE;
      const onBehalf = rng.chance(ON_BEHALF_RATE);
      const bookedBy = onBehalf ? rng.pick(bookableUsers) : user;

      for (const slot of slots) {
        taken.add(`${seat.seatCode}|${slot}`);
        const { startsAt, endsAt } = slotBounds(date, slot);

        let status: schema.BookingStatus;
        let checkedInAt: Date | null = null;
        let releasedAt: Date | null = null;
        let cancelledAt: Date | null = null;

        if (cancelled) {
          status = "cancelled_by_user";
          cancelledAt = new Date(startsAt.getTime() - rng.int(2, 40) * 3600_000);
        } else if (noShow) {
          // Auto-release fires 120 minutes into the slot; the row then settles
          // to completed_no_show once the slot is over.
          releasedAt = new Date(startsAt.getTime() + 120 * 60_000);
          status = isPast ? "completed_no_show" : "auto_released";
        } else if (isPast) {
          status = "completed";
          checkedInAt = new Date(startsAt.getTime() + rng.int(-15, 45) * 60_000);
        } else if (isFuture) {
          status = "confirmed";
        } else {
          // Today: some have badged in already, some have not.
          const arrived = rng.chance(0.75);
          status = arrived ? "checked_in" : "confirmed";
          if (arrived) {
            checkedInAt = new Date(startsAt.getTime() + rng.int(-15, 45) * 60_000);
          }
        }

        bookingRows.push({
          id: id("booking", seat.seatCode, date, slot),
          seatId: seat.id,
          bookingDate: date,
          slot,
          startsAt,
          endsAt,
          bookedByUserId: bookedBy.id,
          occupantUserId: user.id,
          status,
          source: onBehalf ? "on_behalf" : "self",
          checkedInAt,
          releasedAt,
          cancelledAt,
          createdAt: new Date(startsAt.getTime() - rng.int(12, 200) * 3600_000),
          updatedAt: startsAt,
        });
      }
    }
  }

  await chunked(bookingRows, 500, async (batch) => {
    await db
      .insert(schema.bookings)
      .values(batch)
      .onConflictDoUpdate({
        target: schema.bookings.id,
        set: {
          status: sql`excluded.status`,
          occupantUserId: sql`excluded.occupant_user_id`,
          bookedByUserId: sql`excluded.booked_by_user_id`,
          source: sql`excluded.source`,
          checkedInAt: sql`excluded.checked_in_at`,
          releasedAt: sql`excluded.released_at`,
          cancelledAt: sql`excluded.cancelled_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  });

  /* ---- room bookings ---- */
  type RoomRow = typeof schema.roomBookings.$inferInsert;
  const roomRows: RoomRow[] = [];
  const roomTitles = [
    "Audit Planning — Q2",
    "Client Onboarding Review",
    "Statutory Audit Debrief",
    "GST Reconciliation Walkthrough",
    "Partner Weekly",
    "Transfer Pricing Discussion",
    "Article Training — Ind AS",
    "Board Pack Review",
    "Internal Controls Workshop",
    "Tax Litigation Update",
  ];
  const organisers = users.filter(
    (u) => u.grade === "partner" || u.grade === "manager" || u.grade === "director",
  );

  for (const date of dates) {
    for (const room of MEETING_ROOMS) {
      // Bigger rooms are busier; the huddle room turns over most often.
      const meetings = rng.int(0, room.capacity >= 10 ? 4 : 3);
      let hour = 9;
      for (let m = 0; m < meetings; m++) {
        const durationHours = rng.chance(0.35) ? 2 : 1;
        if (hour + durationHours > 19) break;
        const startsAt = fromZonedTime(
          `${date}T${String(hour).padStart(2, "0")}:00:00`,
          TZ,
        );
        const endsAt = new Date(startsAt.getTime() + durationHours * 3600_000);
        const organiser = rng.pick(organisers);
        roomRows.push({
          id: id("roombooking", room.name, date, String(hour)),
          roomId: id("room", room.name),
          startsAt,
          endsAt,
          organiserUserId: organiser.id,
          title: rng.pick(roomTitles),
          status: "confirmed",
          calendarEventId: `demo-evt-${id("roombooking", room.name, date, String(hour))}`,
          syncStatus: "synced",
          createdAt: new Date(startsAt.getTime() - rng.int(6, 96) * 3600_000),
        });
        // Step past this meeting plus a gap, so the seed never trips the
        // exclusion constraint.
        hour += durationHours + rng.int(1, 3);
      }
    }
  }

  await chunked(roomRows, 500, async (batch) => {
    await db
      .insert(schema.roomBookings)
      .values(batch)
      .onConflictDoUpdate({
        target: schema.roomBookings.id,
        set: {
          title: sql`excluded.title`,
          startsAt: sql`excluded.starts_at`,
          endsAt: sql`excluded.ends_at`,
          organiserUserId: sql`excluded.organiser_user_id`,
          status: sql`excluded.status`,
        },
      });
  });

  /* ---- report ---- */
  const counts = await db.execute(sql`
    select
      (select count(*) from users)          as users,
      (select count(*) from seats)          as seats,
      (select count(*) from seats where status = 'fixed')    as fixed_seats,
      (select count(*) from seats where status = 'bookable') as bookable_seats,
      (select count(*) from bookings)       as bookings,
      (select count(*) from bookings where status = 'auto_released'
                                         or status = 'completed_no_show') as no_shows,
      (select count(*) from bookings where status = 'cancelled_by_user')  as cancelled,
      (select count(*) from bookings where source = 'on_behalf')          as on_behalf,
      (select count(*) from meeting_rooms)  as meeting_rooms,
      (select count(*) from room_bookings)  as room_bookings,
      (select count(*) from holidays)       as holidays
  `);

  console.table(counts.rows);
  console.log(`fixed seat pairings: ${fixedPairs}`);
  console.log(`booking dates covered: ${dates.length} working days`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
