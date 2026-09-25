/**
 * THE MEASURE VOCABULARY — the single definition of what occupancy means.
 *
 * Everything on the analytics screens, every CSV export and the headline number
 * are built from the expressions in this file. If a number needs to change, it
 * changes here and nowhere else, exactly as SEAT_STATUS_TOKENS is the one place
 * a seat colour is decided.
 *
 * ---------------------------------------------------------------------------
 * THE OPEN QUESTION THIS FILE REFUSES TO ANSWER
 *
 * CBVA has not decided how an auto-released desk should be accounted for, and
 * we are not entitled to pick for them. So all three candidate measures are
 * computed side by side over the same filters:
 *
 *   (a) seats booked      — a claim on a desk
 *   (b) seats attended    — evidence somebody used it
 *   (c) seat-hours        — a PM desk released at 15:00 still consumed 2 hours
 *
 * Answering that question with data is exactly the kind of thing that makes a
 * client trust the tool, so the product shows the three and explains them
 * rather than collapsing them into one confident-looking figure.
 * ---------------------------------------------------------------------------
 */
import { sql, type SQL } from "drizzle-orm";

/* ------------------------------------------------------------ the partition */

/**
 * The eight booking statuses, partitioned by what each one is EVIDENCE OF.
 * All eight are accounted for; none is allowed to fall through a default.
 *
 * | status                   | booked | attended | seat-hours end   |
 * |--------------------------|--------|----------|------------------|
 * | confirmed                |   ✓    |          | least(ends, now) |
 * | checked_in               |   ✓    |    ✓     | least(ends, now) |
 * | completed                |   ✓    |    ✓     | ends_at          |
 * | completed_no_show        |   ✓    |          | ends_at          |
 * | auto_released            |   ✓    |          | released_at      |
 * | cancelled_after_check_in |   ✓    |    ✓     | cancelled_at     |
 * | cancelled_by_user        |        |          | cancelled_at → 0 |
 * | cancelled_by_admin       |        |  if C-I  | cancelled_at     |
 *
 * ADR-024 and the Phase 3 handoff both insist these stay separated rather than
 * collapsed into "no-show". Collapsing them is not a display simplification —
 * it corrupts the utilisation figure in the direction that looks plausible.
 */
export const BOOKED_STATUSES = [
  "confirmed",
  "checked_in",
  "completed",
  "completed_no_show",
  "auto_released",
  "cancelled_after_check_in",
] as const;

/**
 * Excluded from `booked`, and provably safe to exclude rather than by
 * assertion: cancelBooking() applies assertBeforeCutoff() unless the caller
 * forces it or the booking is already checked in, and a plain user cancellation
 * is neither. So one of these rows was always surrendered at least
 * `cutoff_minutes` before its own slot started — it never held the desk during
 * the slot it names. That is demand which evaporated, and it gets its own
 * column rather than being folded into occupancy.
 */
export const CANCELLED_STATUSES = ["cancelled_by_user", "cancelled_by_admin"] as const;

/** A claim that survived to its own slot. The numerator for (a). */
export const BOOKED = sql`b.status in ('confirmed','checked_in','completed','completed_no_show','auto_released','cancelled_after_check_in')`;

/**
 * Evidence somebody was physically there, keyed on the timestamp and NEVER on
 * the status. An admin force-cancelling a checked-in booking does not un-happen
 * a person having been at that desk, and `cancelled_by_admin` is our action
 * rather than a fact about them (ADR-024).
 */
export const ATTENDED = sql`b.checked_in_at is not null`;

/* -------------------------------------------------------- (a) seats booked */

/**
 * "Seats booked" is THREE numbers, not one, and shipping only one of them is a
 * wrong answer whichever you pick.
 *
 * `seat_slot_unique` is partial on ('confirmed','checked_in'), so after an
 * auto-release the desk is legitimately rebooked and BOTH rows complete. That
 * means count(*) can exceed capacity and is not a utilisation numerator, while
 * count(distinct seat_id) cannot rise above capacity and so is not a demand
 * figure. The gap between them is not noise — `claims > desksClaimed` IS the
 * auto-release-and-rebook finding, which is one of the more interesting things
 * this product can tell CBVA.
 */
export const desksClaimed = sql<number>`count(distinct b.seat_id) filter (where ${BOOKED})::int`;

/** Every claim, including a desk claimed twice in one slot after a release. */
export const claims = sql<number>`count(*) filter (where ${BOOKED})::int`;

/**
 * Distinct people. `occupant_slot_unique` guarantees one desk per person per
 * slot, so this is the figure that actually answers "how many desks does this
 * firm need", and it counts the OCCUPANT, never whoever did the booking.
 */
export const peopleClaiming = sql<number>`count(distinct b.occupant_user_id) filter (where ${BOOKED})::int`;

/** Demand that evaporated before the slot. Reported, never blended in. */
export const cancellations = sql<number>`count(*) filter (where b.status in ('cancelled_by_user','cancelled_by_admin'))::int`;

/* ------------------------------------------------------ (b) seats attended */

export const desksAttended = sql<number>`count(distinct b.seat_id) filter (where ${ATTENDED})::int`;

export const peopleAttended = sql<number>`count(distinct b.occupant_user_id) filter (where ${ATTENDED})::int`;

/**
 * A19, made queryable. A door badge proves somebody reached the floor; a desk
 * QR proves they used THIS desk. Desk-level occupancy is the number CBVA is
 * commissioning, so the two kinds of evidence are counted apart and never
 * summed into a single "attended" that quietly means both.
 */
export const deskVerifiedAttended = sql<number>`count(distinct b.seat_id) filter (where ${ATTENDED} and b.check_in_method = 'qr')::int`;

export const badgeOnlyAttended = sql<number>`count(distinct b.seat_id) filter (where ${ATTENDED} and b.check_in_method = 'badge')::int`;

/** Booked and never attended — the no-show count, on evidence not on status. */
export const noShows = sql<number>`count(*) filter (where ${BOOKED} and b.checked_in_at is null and b.status in ('completed_no_show','auto_released'))::int`;

export const autoReleased = sql<number>`count(*) filter (where b.status = 'auto_released')::int`;

/* -------------------------------------------------------- (c) seat-hours */

/**
 * How long each booking actually held its desk, in hours.
 *
 * THE TRAP THIS FUNCTION EXISTS TO AVOID: `released_at` is overloaded. The
 * auto-release job writes it on the `completed_no_show` transition as well as
 * on `auto_released` (auto-release.ts), and the seed writes a DIFFERENT value
 * for the same status. So the obvious
 *
 *     coalesce(released_at, cancelled_at, ends_at)
 *
 * under-counts no-show hours by roughly half on demo data and not at all in
 * production — a plausible-looking wrong number, in the direction that flatters
 * the floor. Every arm below therefore switches on `status` explicitly.
 *
 * Three further details, each of which is a silent wrong number if missed:
 *
 *  1. `coalesce` goes INSIDE each CASE arm, not around the `least`. Postgres
 *     `least` IGNORES nulls, so `least(null, ends_at)` is `ends_at` — a
 *     cancelled row with a null `cancelled_at` would score a full slot.
 *  2. `least(…, ends_at)` caps the seeded/runtime `released_at` divergence and
 *     any job that ran late.
 *  3. `greatest(0, …)` is what makes a pre-slot cancellation cost nothing,
 *     with no branch of its own.
 *
 * `completed_no_show` consumes the FULL slot, deliberately. The row sat inside
 * `seat_slot_unique`'s predicate from `starts_at` until the job settled it, so
 * nobody else could book that desk for one second of that slot. If a no-show
 * were free, the analytics could not answer "what do no-shows cost us in
 * desks", which is the question. Note the asymmetry that falls out and say it
 * out loud in the report: an auto-released no-show costs the grace window, a
 * `completed_no_show` costs the whole slot, and the only difference between
 * them is whether the grace window expired before the slot ended.
 *
 * @param now  Injected, never `new Date()` — a live booking accrues hours as
 *             its slot runs, and the demo clock has to move that number.
 */
export function seatHoursConsumed(now: Date): SQL<string> {
  return sql`coalesce(sum(
    greatest(0, extract(epoch from (
      least(
        case b.status
          when 'auto_released'            then coalesce(b.released_at,  b.ends_at)
          when 'cancelled_after_check_in' then coalesce(b.cancelled_at, b.starts_at)
          when 'cancelled_by_admin'       then coalesce(b.cancelled_at, b.starts_at)
          when 'cancelled_by_user'        then coalesce(b.cancelled_at, b.starts_at)
          when 'confirmed'                then ${now}::timestamptz
          when 'checked_in'               then ${now}::timestamptz
          else b.ends_at
        end,
        b.ends_at)
      - b.starts_at)) / 3600.0)), 0)::numeric(12,2)`;
}

/**
 * The same measure under the OTHER accounting rule — a no-show that was never
 * released costs nothing rather than the whole slot.
 *
 * This exists so the open client question is a column the partners can toggle
 * rather than a rewrite we have to come back for. The GAP between this and
 * `seatHoursConsumed` is itself a headline: it is the cost of no-shows, in
 * desk-hours, for the period on screen.
 */
export function seatHoursIfNoShowWereFree(now: Date): SQL<string> {
  return sql`coalesce(sum(
    greatest(0, extract(epoch from (
      least(
        case b.status
          when 'auto_released'            then coalesce(b.released_at,  b.ends_at)
          when 'completed_no_show'        then b.starts_at
          when 'cancelled_after_check_in' then coalesce(b.cancelled_at, b.starts_at)
          when 'cancelled_by_admin'       then coalesce(b.cancelled_at, b.starts_at)
          when 'cancelled_by_user'        then coalesce(b.cancelled_at, b.starts_at)
          when 'confirmed'                then ${now}::timestamptz
          when 'checked_in'               then ${now}::timestamptz
          else b.ends_at
        end,
        b.ends_at)
      - b.starts_at)) / 3600.0)), 0)::numeric(12,2)`;
}

/* ------------------------------------------------------------- the measures */

/** Which measure a screen or an export is currently expressing. */
export const MEASURE_KEYS = ["booked", "attended", "seat_hours"] as const;
export type MeasureKey = (typeof MEASURE_KEYS)[number];

export interface MeasureDescriptor {
  key: MeasureKey;
  label: string;
  /** The one-line explanation shown beside the toggle. */
  blurb: string;
  /** What it counts, in the words a partner would use. */
  counts: string;
  /** What it deliberately does NOT tell you. */
  caveat: string;
  unit: "desks" | "hours";
}

/**
 * The explainer. Rendered next to the three measures on every analytics screen,
 * because a number whose definition is not on screen beside it is a number
 * somebody will quote wrongly in a board pack.
 */
export const MEASURES: Record<MeasureKey, MeasureDescriptor> = {
  booked: {
    key: "booked",
    label: "Seats booked",
    blurb: "Desks claimed for the slot, whether or not anybody turned up.",
    counts:
      "Every booking that still held its desk when the slot began — including the ones nobody checked into.",
    caveat:
      "A claim is not evidence of use. Cancellations made before the cut-off are excluded; they are counted separately as demand that evaporated.",
    unit: "desks",
  },
  attended: {
    key: "attended",
    label: "Seats attended",
    blurb: "Desks somebody actually checked into.",
    counts:
      "Bookings with a check-in recorded, by QR at the desk, by badge at the door, or in the app.",
    caveat:
      "The strictest measure, and the one most likely to understate: somebody who came in and never scanned looks identical to somebody who stayed home.",
    unit: "desks",
  },
  seat_hours: {
    key: "seat_hours",
    label: "Seat-hours consumed",
    blurb: "How long each desk was actually held, not how many were claimed.",
    counts:
      "Time from slot start until the desk went back to the pool. A PM desk auto-released at 15:00 consumed two hours, not four.",
    caveat:
      "A booking nobody checked into but which was never released consumed the whole slot — nobody else could take that desk. That accounting is still open with CBVA; the alternative is shown alongside.",
    unit: "hours",
  },
};

/** The five terminal statuses, kept apart because they mean different things. */
export const TERMINAL_STATUS_LABELS: Record<string, { label: string; meaning: string }> = {
  completed: { label: "Completed", meaning: "Checked in and used the slot." },
  completed_no_show: {
    label: "No show",
    meaning: "Claimed the desk, never came, and it was never released.",
  },
  auto_released: {
    label: "Auto released",
    meaning: "Claimed the desk, never checked in, so the grace window handed it back.",
  },
  cancelled_by_user: {
    label: "Cancelled",
    meaning: "Their decision, before the cut-off. The desk was free for the whole slot.",
  },
  cancelled_after_check_in: {
    label: "Left early",
    meaning: "Arrived, then gave the rest of the slot back.",
  },
  cancelled_by_admin: {
    label: "Cancelled by admin",
    meaning: "Our action, not theirs. Never counted as a no-show against a person.",
  },
};
