/**
 * What "presentable" means for the deployed demo, as a pure function.
 *
 * WHY THIS IS SEPARATE FROM prod.mjs. Phase 6's deploy promoted code that
 * selected a column production did not have. Every meeting-room query failed,
 * and recovering from it ran the seed, which deletes bookings and room_bookings
 * wholesale before regenerating them (ADR-008) -- so failing between the delete
 * and the insert left production with ZERO bookings and ONE meeting room.
 *
 * `prod:check` was run afterwards and said "looks presentable" against THREE
 * bookings. It selected the count, printed it, and asserted nothing about it.
 * A guard that greenlights the exact damage it exists to catch is worse than no
 * guard, because it also supplies a reason not to look.
 *
 * Pulling the judgement out of the transport is what makes it testable. The
 * damaged shapes that actually occurred are in tests/unit/prod-check.test.ts and
 * run on every `npm test`, so this cannot quietly regress the way it quietly
 * failed to exist.
 *
 * FAILURES exit non-zero; WARNINGS do not. The distinction is whether a partner
 * opening the demo would see something wrong.
 */

/**
 * The seed builds eight weeks of history plus five forward working days, which
 * comes out around 5,800 bookings. The floor is deliberately well below that:
 * it is not a precise expectation, it is the line under which the demo has
 * visibly lost its history. Three bookings is the number that got past the old
 * check; two thousand is comfortably above any legitimate variation in the
 * seed and comfortably below anything that looks populated.
 */
export const MIN_BOOKINGS = 2000;

/** From the drawing, and asserted by the geometry tests (A3). */
export const EXPECTED_ROOMS = 5;
export const EXPECTED_SEATS = 141;
export const EXPECTED_USERS = 141;

/**
 * @param {object} counts - one row of the prod:check query
 * @param {{applied: string[], onDisk: string[]}} migrations
 * @returns {{failures: string[], warnings: string[]}}
 */
export function evaluateProduction(counts, migrations) {
  const failures = [];
  const warnings = [];

  /*
   * SCHEMA DRIFT FIRST, because it is the one that actually happened and the
   * only one that is a live outage rather than a presentation problem. Nothing
   * in this project sequences a migration against a deploy: `npm run db:migrate`
   * reads .env.local, so it migrates the LOCAL database, and the deploy then
   * promotes code that selects a column production has never been given. That
   * was invisible for five phases because no phase added a column. The first
   * one that did took the site down.
   */
  const missing = migrations.onDisk.filter((m) => !migrations.applied.includes(m));
  if (missing.length > 0) {
    failures.push(
      `schema is BEHIND the code: ${missing.length} migration(s) not applied ` +
        `(${missing.join(", ")}). Run prod:migrate BEFORE deploying — code that ` +
        `selects a column production does not have fails every request.`,
    );
  }
  const extra = migrations.applied.filter((m) => !migrations.onDisk.includes(m));
  if (extra.length > 0) {
    warnings.push(
      `production has ${extra.length} migration(s) this checkout does not ` +
        `(${extra.join(", ")}) — are you on an older branch?`,
    );
  }

  if (counts.bookings < MIN_BOOKINGS) {
    failures.push(
      `only ${counts.bookings} bookings, expected at least ${MIN_BOOKINGS}. ` +
        `The demo history is gone — this is what an interrupted seed leaves ` +
        `behind. Run prod:seed. (The old check called 3 bookings "presentable".)`,
    );
  }

  if (counts.meeting_rooms !== EXPECTED_ROOMS) {
    failures.push(
      `${counts.meeting_rooms} meeting rooms, expected ${EXPECTED_ROOMS}. ` +
        `The seed deletes rooms no longer in MEETING_ROOMS before inserting, ` +
        `so a partial run leaves exactly this.`,
    );
  }

  if (counts.seats !== EXPECTED_SEATS) {
    failures.push(`${counts.seats} seats, expected ${EXPECTED_SEATS} — test debris?`);
  }
  if (counts.users !== EXPECTED_USERS) {
    failures.push(`${counts.users} users, expected ${EXPECTED_USERS} — test debris?`);
  }

  /* Warnings: real, but a partner would not see them. */
  if (counts.clock_offset !== 0) {
    warnings.push(`clock offset is ${counts.clock_offset}s — reset it before a demo`);
  }
  if (counts.queued_mail > 50) {
    warnings.push(`${counts.queued_mail} messages queued — is the cron running?`);
  }
  if (counts.bookable === 0) {
    failures.push("no bookable seats at all — nobody could book anything");
  }
  if (counts.series === 0) {
    warnings.push("no active recurring series — the seed usually leaves some");
  }
  if (counts.live_releases === 0) {
    warnings.push("no live seat releases — the seed usually leaves some");
  }

  return { failures, warnings };
}
