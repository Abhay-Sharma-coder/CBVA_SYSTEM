-- Phase 5 — analytics, the adoption features, and bounding the one job that
-- can rewrite history.
--
-- Hand-written and hand-registered in drizzle/meta/_journal.json, like 0001 and
-- 0002. Every partial index and CHECK below is a rule the DATABASE must own;
-- drizzle-kit cannot express any of the predicates, and re-generating over the
-- top of this file would silently drop them.

-- ---------------------------------------------------------------------------
-- 1. Releasing a fixed seat.
--
-- 47 of the 141 desks are allocated to Manager grade and above and are never
-- bookable. That means they contribute nothing to the occupancy data — they are
-- a constant, not a measurement. A partner who frees their desk on a WFH day
-- both increases usable supply and puts that desk into the analytics for the
-- first time, which is the only route by which the fixed pool is ever measured.
--
-- The unique index is PARTIAL on revoked_at IS NULL, the same shape and for the
-- same reason as seat_slot_unique: revoking is a status change, never a delete,
-- because the history is the analytics. A desk released and then reclaimed is a
-- fact about how the floor was used, and it survives.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seat_releases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_id             uuid NOT NULL REFERENCES seats(id) ON DELETE RESTRICT,
  release_date        date NOT NULL,
  slot                text NOT NULL,
  -- Derived by deriveSlotBounds() in src/lib/slots.ts and nowhere else, exactly
  -- like bookings.starts_at/ends_at. Stored so a release can be range-scanned,
  -- and so the updateSettings() backfill can find and correct it (ADR-021).
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  owner_user_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  released_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note                text,
  revoked_at          timestamptz,
  revoked_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seat_release_range_valid CHECK (ends_at > starts_at)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS seat_release_unique
  ON seat_releases (seat_id, release_date, slot)
  WHERE revoked_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS seat_releases_date_slot_idx
  ON seat_releases (release_date, slot)
  WHERE revoked_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS seat_releases_owner_idx
  ON seat_releases (owner_user_id, release_date);
--> statement-breakpoint

-- A booking that only exists because a fixed desk was released points at the
-- release. Two readers: analytics (how much demand did released desks absorb?)
-- and the revoke path, which must refuse to reclaim a desk somebody is already
-- sitting at. ON DELETE RESTRICT, so a release that has been booked against can
-- never be deleted out from under its booking.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS release_id uuid
  REFERENCES seat_releases(id) ON DELETE RESTRICT;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS bookings_release_idx
  ON bookings (release_id) WHERE release_id IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Recurring bookings.
--
-- weekdays is ISO: 1 = Monday through 7 = Sunday, matching extract(isodow), so
-- the materialiser compares against the same number Postgres reports and there
-- is no off-by-one between the two.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_series (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occupant_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat_id            uuid NOT NULL REFERENCES seats(id) ON DELETE RESTRICT,
  slot               text NOT NULL,
  weekdays           smallint[] NOT NULL,
  starts_on          date NOT NULL,
  ends_on            date,
  status             text NOT NULL DEFAULT 'active',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_series_status_valid
    CHECK (status IN ('active', 'paused', 'ended')),
  CONSTRAINT booking_series_weekdays_valid
    CHECK (array_length(weekdays, 1) BETWEEN 1 AND 7
           AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CONSTRAINT booking_series_range_valid
    CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS booking_series_active_idx
  ON booking_series (created_at, id) WHERE status = 'active';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS booking_series_occupant_idx
  ON booking_series (occupant_user_id);
--> statement-breakpoint

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS series_id uuid
  REFERENCES booking_series(id) ON DELETE SET NULL;
--> statement-breakpoint

-- DELIBERATELY NOT PARTIAL ON STATUS, and that is the whole design.
--
-- Cancelling one occurrence of a series leaves a cancelled row still carrying
-- (series_id, booking_date, slot). The next INSERT ... ON CONFLICT DO NOTHING
-- from the materialiser therefore conflicts with it and does nothing, so a
-- cancelled occurrence is never resurrected on the next job run. THE CANCELLED
-- ROW IS THE TOMBSTONE — which is why there is no separate exceptions table and
-- no skip list to keep in sync with reality.
--
-- Consequence, and it is load-bearing: editBooking() is cancel-and-rebook
-- (ADR-023), so the rebooked row MUST be inserted with series_id NULL. It has
-- detached from the series by definition, and leaving the id on it would
-- collide with its own tombstone.
CREATE UNIQUE INDEX IF NOT EXISTS booking_series_occurrence_unique
  ON bookings (series_id, booking_date, slot)
  WHERE series_id IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Coworker visibility.
--
-- Defaults true: the feature exists to counter the adoption risk that low seat
-- contention means nobody bothers booking, and a roster nobody has opted into
-- is an empty screen that argues for nothing. Opting out hides the NAME, never
-- the desk — an opted-out person still shows as a held seat, so the occupancy
-- data is unaffected by the privacy choice.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS share_attendance boolean NOT NULL DEFAULT true;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. The outbox has to be able to talk about a booking that was never created.
--
-- notification_log_job_kind_once keys on booking_id, which is NULL when the
-- materialiser could not get the seat. Without a second key, the message saying
-- we could not get you C3-04 on Thursday would be re-sent on every cron tick.
-- ---------------------------------------------------------------------------
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS series_id uuid
  REFERENCES booking_series(id) ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS occurrence_date date;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS notification_log_series_once
  ON notification_log (kind, series_id, occurrence_date, recipient_email)
  WHERE series_id IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Analytics.
--
-- Rows are never deleted — a cancelled booking keeps its row because the
-- history IS the product — so the table grows monotonically and every report
-- would otherwise be a sequential scan over all of it. Every measure groups by
-- (booking_date, slot) and filters on status; the INCLUDE list carries the rest
-- of what the three measures read, so the aggregates stay index-only.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS bookings_analytics_idx
  ON bookings (booking_date, slot, status)
  INCLUDE (seat_id, occupant_user_id, starts_at, ends_at,
           released_at, cancelled_at, checked_in_at);
--> statement-breakpoint

-- check_in_method is free text and is NULL on every row today. Close the
-- vocabulary BEFORE the analytics starts grouping by it: A19 turns on qr being
-- desk-level evidence and badge being floor-level, and a mistyped fifth value
-- would silently become a fifth category in the report.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS booking_check_in_method_valid;
--> statement-breakpoint

ALTER TABLE bookings ADD CONSTRAINT booking_check_in_method_valid
  CHECK (check_in_method IS NULL
         OR check_in_method IN ('qr', 'badge', 'app', 'admin'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Bounding auto-release (ASSUMPTIONS A22).
--
-- A test once drove the job from a clock set to 2099 and it settled 577
-- bookings, emptying the demo floor, because all three transitions are
-- unbounded UPDATEs. The bound is settings-backed rather than a constant
-- because the right cap is a function of the bookable pool and the number of
-- slots per day, and both of those are configuration.
--
-- The demo offset CHECK closes the most likely route to that failure at source:
-- POST /api/clock accepts any integer today, and one fat-fingered value moves
-- the clock far enough that every future booking looks expired.
-- ---------------------------------------------------------------------------
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_release_batch_cap integer NOT NULL DEFAULT 250;
--> statement-breakpoint

ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_release_horizon_days integer NOT NULL DEFAULT 3;
--> statement-breakpoint

ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_demo_offset_bounded;
--> statement-breakpoint

ALTER TABLE settings ADD CONSTRAINT settings_demo_offset_bounded
  CHECK (demo_offset_seconds BETWEEN -2592000 AND 2592000);
