-- Hand-written. Drizzle cannot express partial indexes with an IN () predicate,
-- exclusion constraints, or a singleton constraint, and these rules must be
-- enforced by the DATABASE, not the application. An app-level check has a race
-- window between the read and the write; nothing in this codebase relies on one.

-- ---------------------------------------------------------------------------
-- 1. One active booking per seat, per date, per slot.
--
-- Partial, so a cancelled or auto-released booking leaves the slot free to be
-- rebooked, and the history of who dropped it is preserved rather than deleted.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS seat_slot_unique
  ON bookings (seat_id, booking_date, slot)
  WHERE status IN ('confirmed', 'checked_in');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. No overlapping meeting room bookings.
--
-- Rooms are booked as arbitrary ranges, not fixed slots, so uniqueness cannot
-- express this — it needs a GiST exclusion constraint. btree_gist supplies the
-- equality operator class for the uuid room_id column.
--
-- '[)' bounds mean an 11:00 booking may start the instant a 10:00-11:00 one
-- ends; only genuine overlap is rejected.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

ALTER TABLE room_bookings DROP CONSTRAINT IF EXISTS no_room_overlap;
--> statement-breakpoint

ALTER TABLE room_bookings ADD CONSTRAINT no_room_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'confirmed');
--> statement-breakpoint

-- A zero-length or inverted range would slip past the exclusion constraint
-- because an empty range overlaps nothing.
ALTER TABLE room_bookings DROP CONSTRAINT IF EXISTS room_booking_range_valid;
--> statement-breakpoint
ALTER TABLE room_bookings ADD CONSTRAINT room_booking_range_valid
  CHECK (ends_at > starts_at);
--> statement-breakpoint

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS booking_range_valid;
--> statement-breakpoint
ALTER TABLE bookings ADD CONSTRAINT booking_range_valid
  CHECK (ends_at > starts_at);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. users.fixed_seat_id -> seats.id
--
-- users and seats reference each other, so this direction is wired after both
-- tables exist rather than in the generated migration.
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_fixed_seat_id_seats_id_fk;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_fixed_seat_id_seats_id_fk
  FOREIGN KEY (fixed_seat_id) REFERENCES seats(id) ON DELETE SET NULL;
--> statement-breakpoint

-- A seat may be allocated to at most one person.
CREATE UNIQUE INDEX IF NOT EXISTS seats_assigned_user_unique
  ON seats (assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. settings is a singleton.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS settings_singleton ON settings ((true));
