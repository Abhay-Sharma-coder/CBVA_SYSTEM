-- Phase 3 — the booking engine.
--
-- Hand-written, like 0001, and hand-registered in drizzle/meta/_journal.json.
-- Everything here is either a rule the DATABASE must own (the two new partial
-- unique indexes) or a shape change the app cannot express through drizzle-kit
-- without losing the 0001 constraints.

-- ---------------------------------------------------------------------------
-- 1. Slot becomes an open vocabulary.
--
-- The brief requires switching from half-days to hourly booking to be a
-- SETTINGS change, not a refactor. A two-value Postgres enum makes that
-- impossible: 'H09' is not a legal value and adding one is a migration.
--
-- The column is dropped from the enum and retyped to text. Slot keys are now
-- validated against settings.slot_definitions at the application boundary
-- (src/lib/slots.ts), which is where an editable vocabulary belongs.
--
-- The dependent index is dropped and recreated explicitly rather than left to
-- ALTER COLUMN's implicit rebuild, so its predicate is visible here.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS seat_slot_unique;
--> statement-breakpoint

ALTER TABLE bookings ALTER COLUMN slot TYPE text USING slot::text;
--> statement-breakpoint

DROP TYPE IF EXISTS slot;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS seat_slot_unique
  ON bookings (seat_id, booking_date, slot)
  WHERE status IN ('confirmed', 'checked_in');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. One person, one desk, per slot.
--
-- Edge cases 9 and 10 in the Phase 3 brief are the same rule seen from two
-- sides: a person may not hold two desks in one slot, and an on-behalf booking
-- for somebody who already has one must be refused. Keying on
-- occupant_user_id gives the carve-out for free — booking FOR a different
-- person is a different key, so it is allowed.
--
-- In the database beside seat_slot_unique for the same reason as ADR-003: an
-- application pre-check has a race window between the read and the write.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS occupant_slot_unique
  ON bookings (occupant_user_id, booking_date, slot)
  WHERE status IN ('confirmed', 'checked_in');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Two booking outcomes analytics has to keep apart.
--
-- 'cancelled_after_check_in' — somebody arrived, was counted as present, then
-- dropped the desk. That is a different fact from a plain cancellation and the
-- occupancy report must not blend them.
--
-- 'cancelled_by_admin' — we cancelled it for them (a desk was blocked, a user
-- was deactivated). Not a signal about that person's attendance at all.
--
-- Both are outside the seat_slot_unique predicate, so both free the desk.
-- ---------------------------------------------------------------------------
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'cancelled_after_check_in';
--> statement-breakpoint

ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'cancelled_by_admin';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Booking columns.
--
-- check_in_method is the point of the QR recommendation: a door swipe proves
-- somebody entered the floor, a desk QR proves they used THAT desk. Analytics
-- cannot treat those as the same evidence, so the row records which it was.
-- ---------------------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS check_in_method text;
--> statement-breakpoint

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_by_user_id uuid;
--> statement-breakpoint

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_cancelled_by_user_id_users_id_fk;
--> statement-breakpoint

ALTER TABLE bookings ADD CONSTRAINT bookings_cancelled_by_user_id_users_id_fk
  FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint

-- The auto-release job's hot path: every confirmed booking whose grace window
-- has expired. Partial, because the job never looks at anything else.
CREATE INDEX IF NOT EXISTS bookings_auto_release_idx
  ON bookings (starts_at)
  WHERE status = 'confirmed';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. notification_log becomes a real outbox.
--
-- It had no insertion timestamp at all, so a queue could not be ordered and
-- the demo inbox could not be sorted. next_attempt_at carries the retry
-- backoff.
-- ---------------------------------------------------------------------------
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint

ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS next_attempt_at timestamp with time zone;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS notification_log_dispatch_idx
  ON notification_log (next_attempt_at)
  WHERE status = 'queued';
--> statement-breakpoint

-- Job-generated notifications must survive the job running twice. A booking
-- can legitimately be edited (and notified) many times, so this is restricted
-- to the kinds a JOB emits, where a second row would be a duplicate, not a
-- second event.
CREATE UNIQUE INDEX IF NOT EXISTS notification_log_job_kind_once
  ON notification_log (kind, booking_id, recipient_email)
  WHERE booking_id IS NOT NULL AND kind IN ('auto_released', 'reminder');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Room bookings: optimistic locking and calendar sync bookkeeping.
--
-- A calendar failure must never lose a booking, so the failure is recorded on
-- the row and a retry job picks it up. That needs somewhere to record it.
-- ---------------------------------------------------------------------------
ALTER TABLE room_bookings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint

ALTER TABLE room_bookings ADD COLUMN IF NOT EXISTS cancelled_at timestamp with time zone;
--> statement-breakpoint

ALTER TABLE room_bookings ADD COLUMN IF NOT EXISTS sync_attempts integer DEFAULT 0 NOT NULL;
--> statement-breakpoint

ALTER TABLE room_bookings ADD COLUMN IF NOT EXISTS sync_error text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS room_bookings_sync_idx
  ON room_bookings (sync_status)
  WHERE sync_status <> 'synced';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Settings the booking engine reads.
--
-- booking_window_working_days is the rule the brief states ("the 5 working day
-- window"); booking_window_days stays as the calendar-day bound the scan stops
-- at, so a long run of holidays cannot make the scan unbounded.
-- ---------------------------------------------------------------------------
ALTER TABLE settings ADD COLUMN IF NOT EXISTS booking_window_working_days integer DEFAULT 5 NOT NULL;
--> statement-breakpoint

ALTER TABLE settings ADD COLUMN IF NOT EXISTS office_hours jsonb DEFAULT '{"start":"08:00","end":"20:00"}'::jsonb NOT NULL;
--> statement-breakpoint

ALTER TABLE settings ADD COLUMN IF NOT EXISTS check_in_opens_minutes_before integer DEFAULT 30 NOT NULL;
