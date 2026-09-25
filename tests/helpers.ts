import { Client, Pool } from "pg";
import { randomUUID } from "node:crypto";

/**
 * Tests always run against the DIRECT (unpooled) endpoint. PgBouncer in
 * transaction mode hands each statement to whichever backend is free, which
 * makes "two transactions racing for the same row" untestable.
 */
export function testConnectionString(): string {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");
  return url;
}

export function testPool(): Pool {
  return new Pool({ connectionString: testConnectionString(), max: 6 });
}

/** A dedicated session, for the concurrency tests. */
export async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: testConnectionString() });
  await client.connect();
  return client;
}

export interface Fixtures {
  seatId: string;
  userId: string;
  roomId: string;
  floorId: string;
  zoneId: string;
  /** Far-future date, so fixtures never collide with seeded booking history. */
  bookingDate: string;
}

/**
 * Creates an isolated island of rows the tests own outright — its own floor,
 * zone, seat, user and room, on a date the seed never touches. Nothing here
 * mutates seeded data, so the suite can run against a working demo database.
 */
export async function createFixtures(pool: Pool): Promise<Fixtures> {
  const tag = randomUUID().slice(0, 8);
  const floorId = randomUUID();
  const zoneId = randomUUID();
  const seatId = randomUUID();
  const userId = randomUUID();
  const roomId = randomUUID();

  await pool.query(
    `insert into floors (id, number, name, is_active) values ($1, $2, $3, true)`,
    [floorId, 900, `Test Floor ${tag}`],
  );
  await pool.query(
    `insert into zones (id, floor_id, code, display_name, sort_order)
     values ($1, $2, $3, $4, 0)`,
    [zoneId, floorId, `T${tag.slice(0, 3)}`, `Test Zone ${tag}`],
  );
  await pool.query(
    `insert into seats (id, zone_id, floor_id, seat_code, bay, plan_x, plan_y,
                        seat_type, status, active_from)
     values ($1, $2, $3, $4, 'TT', 0, 0, 'workstation', 'bookable', '2020-01-01')`,
    [seatId, zoneId, floorId, `TT-${tag}`],
  );
  await pool.query(
    `insert into users (id, email, display_name, grade, seat_mode)
     values ($1, $2, $3, 'article', 'bookable')`,
    [userId, `test.${tag}@cbva.test`, `Test User ${tag}`],
  );
  await pool.query(
    `insert into meeting_rooms (id, floor_id, name, capacity)
     values ($1, $2, $3, 6)`,
    [roomId, floorId, `Test Room ${tag}`],
  );

  return { seatId, userId, roomId, floorId, zoneId, bookingDate: "2099-01-05" };
}

export async function destroyFixtures(pool: Pool, f: Fixtures): Promise<void> {
  await pool.query(`delete from bookings where seat_id = $1`, [f.seatId]);
  await pool.query(`delete from room_bookings where room_id = $1`, [f.roomId]);
  await pool.query(`delete from meeting_rooms where id = $1`, [f.roomId]);
  await pool.query(`delete from seats where id = $1`, [f.seatId]);
  await pool.query(`delete from users where id = $1`, [f.userId]);
  await pool.query(`delete from zones where id = $1`, [f.zoneId]);
  await pool.query(`delete from floors where id = $1`, [f.floorId]);
}

/** Inserts one booking. `runner` may be a Pool or a session-bound Client. */
export function insertBooking(
  runner: Pool | Client,
  f: Fixtures,
  opts: {
    slot?: "AM" | "PM";
    status?: string;
    date?: string;
    id?: string;
    startsAt?: string;
    endsAt?: string;
  } = {},
) {
  const date = opts.date ?? f.bookingDate;
  return runner.query(
    `insert into bookings
       (id, seat_id, booking_date, slot, starts_at, ends_at,
        booked_by_user_id, occupant_user_id, status, source)
     values ($1, $2, $3, $4, $5, $6, $7, $7, $8, 'self')
     returning id`,
    [
      opts.id ?? randomUUID(),
      f.seatId,
      date,
      opts.slot ?? "AM",
      opts.startsAt ?? `${date}T03:30:00Z`,
      opts.endsAt ?? `${date}T08:00:00Z`,
      f.userId,
      opts.status ?? "confirmed",
    ],
  );
}

/** Inserts one room booking over an explicit UTC range. */
export function insertRoomBooking(
  runner: Pool | Client,
  f: Fixtures,
  startsAt: string,
  endsAt: string,
  status = "confirmed",
) {
  return runner.query(
    `insert into room_bookings
       (id, room_id, starts_at, ends_at, organiser_user_id, title, status)
     values ($1, $2, $3, $4, $5, 'Test Meeting', $6)
     returning id`,
    [randomUUID(), f.roomId, startsAt, endsAt, f.userId, status],
  );
}

export interface PgError extends Error {
  code?: string;
  constraint?: string;
}

export function asPgError(err: unknown): PgError {
  return err as PgError;
}
