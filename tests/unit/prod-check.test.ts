import { describe, expect, it } from "vitest";

// @ts-expect-error - .mjs script module, deliberately outside the app's tsconfig
// paths. prod:check runs under plain node before any build step exists, so its
// predicate cannot be a TS module without adding tsx to the production path.
import { MIN_BOOKINGS, evaluateProduction } from "../../scripts/prod-check.mjs";

/**
 * `prod:check` reported "looks presentable" against THREE bookings, immediately
 * after the Phase 6 deploy emptied production. It selected the count, printed
 * it, and asserted nothing about it.
 *
 * These are the three damage shapes that actually occurred, so the guard cannot
 * regress back into the state it was in. They run on every `npm test`, which is
 * the difference between a guard and a guard nobody has seen fail.
 */

const ALL_MIGRATIONS = [
  "0000_initial_schema",
  "0001_constraints",
  "0002_booking_engine",
  "0003_phase5",
  "0004_room_bay_code",
];

const healthy = {
  users: 141,
  seats: 141,
  bookable: 93,
  bookings: 5804,
  meeting_rooms: 5,
  live_releases: 3,
  series: 4,
  clock_offset: 0,
  queued_mail: 2,
};

const fullyMigrated = { applied: ALL_MIGRATIONS, onDisk: ALL_MIGRATIONS };

describe("evaluateProduction — a healthy deployment", () => {
  it("passes with no failures and no warnings", () => {
    const { failures, warnings } = evaluateProduction(healthy, fullyMigrated);
    expect(failures).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe("the three shapes the Phase 6 incident actually produced", () => {
  it("FAILS on a near-empty bookings table — the exact false green", () => {
    // This is the state prod:check was run against and called presentable.
    const { failures } = evaluateProduction(
      { ...healthy, bookings: 3 },
      fullyMigrated,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/only 3 bookings/);
    expect(failures[0]).toMatch(/prod:seed/);
  });

  it("FAILS when the seed left one meeting room instead of five", () => {
    const { failures } = evaluateProduction(
      { ...healthy, meeting_rooms: 1 },
      fullyMigrated,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/1 meeting rooms, expected 5/);
  });

  it("FAILS when a migration is on disk but not applied — the cause, not the damage", () => {
    // bay_code was in schema.ts AND in drizzle/0004, journalled and committed.
    // It had simply never reached production, because db:migrate reads
    // .env.local. The deploy then promoted code that selected it.
    const { failures } = evaluateProduction(healthy, {
      applied: ALL_MIGRATIONS.slice(0, 4),
      onDisk: ALL_MIGRATIONS,
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/schema is BEHIND the code/);
    expect(failures[0]).toMatch(/0004_room_bay_code/);
    expect(failures[0]).toMatch(/prod:migrate BEFORE deploying/);
  });

  it("reports ALL of them together when the whole incident is reproduced", () => {
    const { failures } = evaluateProduction(
      { ...healthy, bookings: 3, meeting_rooms: 1 },
      { applied: ALL_MIGRATIONS.slice(0, 4), onDisk: ALL_MIGRATIONS },
    );
    // Migration drift first: it is the cause, and the only live outage.
    expect(failures[0]).toMatch(/schema is BEHIND/);
    expect(failures).toHaveLength(3);
  });
});

describe("the boundary of the bookings floor", () => {
  it("passes exactly at the floor and fails one below it", () => {
    expect(
      evaluateProduction({ ...healthy, bookings: MIN_BOOKINGS }, fullyMigrated)
        .failures,
    ).toEqual([]);
    expect(
      evaluateProduction({ ...healthy, bookings: MIN_BOOKINGS - 1 }, fullyMigrated)
        .failures,
    ).toHaveLength(1);
  });
});

describe("failures versus warnings", () => {
  it("treats a stray demo clock as a warning, not a failure", () => {
    // Real, and worth saying, but a partner opening the demo sees a working
    // floor. Only things that make the demo WRONG may block a deploy.
    const { failures, warnings } = evaluateProduction(
      { ...healthy, clock_offset: 7200 },
      fullyMigrated,
    );
    expect(failures).toEqual([]);
    expect(warnings[0]).toMatch(/clock offset is 7200s/);
  });

  it("warns when production is AHEAD of this checkout rather than failing", () => {
    // An older branch is a mistake about which code you are looking at, not
    // damage to production.
    const { failures, warnings } = evaluateProduction(healthy, {
      applied: ALL_MIGRATIONS,
      onDisk: ALL_MIGRATIONS.slice(0, 4),
    });
    expect(failures).toEqual([]);
    expect(warnings[0]).toMatch(/production has 1 migration/);
  });

  it("fails when nothing is bookable at all", () => {
    const { failures } = evaluateProduction(
      { ...healthy, bookable: 0 },
      fullyMigrated,
    );
    expect(failures.some((f: string) => /nobody could book/.test(f))).toBe(true);
  });
});
