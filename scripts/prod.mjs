/**
 * Run a database script against the DEPLOYED demo database.
 *
 * WHY THIS EXISTS RATHER THAN A DOCUMENTED `export DATABASE_URL=…`. Every
 * database script in this repo defaults to `.env.local`, which is the local
 * test database. Aiming one at production by hand means exporting two
 * connection strings correctly, in the right shell, every time — and the
 * failure mode of getting it wrong is silent: you rebuild the wrong database's
 * eight weeks of history and only find out when somebody opens the demo.
 *
 * So production is a different verb, not a different variable. It:
 *
 *   1. loads `.env.production.local` (gitignored, holds the credentials),
 *   2. PRINTS THE HOST IT IS ABOUT TO TOUCH before doing anything,
 *   3. refuses without an explicit `--yes-production`,
 *   4. refuses outright if the resolved host looks like the local database.
 *
 *   node scripts/prod.mjs check                      # read-only, no flag needed
 *   node scripts/prod.mjs migrate --yes-production
 *   node scripts/prod.mjs seed    --yes-production
 *   node scripts/prod.mjs jobs    --yes-production
 *
 * There is deliberately NO `reset` verb. Dropping the production schema is not
 * something that should be one word away.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { config } from "dotenv";
import pg from "pg";

import { evaluateProduction } from "./prod-check.mjs";

const ENV_FILE = ".env.production.local";

/** The local database, so we can refuse to "deploy" onto it by accident. */
const LOCAL_HOST_FRAGMENT = "ep-empty-hall";

/** Written this way so no escape sequence can be mangled into a real one. */
const NL = String.fromCharCode(10);

const VERBS = {
  check: null, // handled inline
  migrate: "scripts/migrate.ts",
  seed: "scripts/seed.ts",
  jobs: "scripts/run-jobs.ts",
  "backfill-slots": "scripts/backfill-slot-bounds.ts",
};

const verb = process.argv[2];
const confirmed = process.argv.includes("--yes-production");

/**
 * A read-only scratch target, for proving that `check` actually fails.
 *
 * A guard nobody has watched fail is not a guard, and the only honest way to
 * watch this one fail is to point it at a database that is genuinely damaged.
 * That cannot be production and must not be the local database the tests and
 * the dev server share, so it is a throwaway created for the purpose.
 *
 * ONLY `check` accepts it, and `check` performs no writes. There is no path
 * from this flag to a write verb -- the guard below is unconditional -- so it
 * cannot become a way to seed or migrate something by accident, which is the
 * whole reason this wrapper exists.
 */
const scratchArg = process.argv.find((a) => a.startsWith("--scratch-url="));
const scratch = scratchArg ? scratchArg.slice("--scratch-url=".length) : null;
if (scratch && verb !== "check") {
  console.error("--scratch-url is only accepted by `check`, which is read-only.");
  process.exit(1);
}

if (!verb || !(verb in VERBS)) {
  console.error(
    `usage: node scripts/prod.mjs <${Object.keys(VERBS).join("|")}> [--yes-production]`,
  );
  process.exit(1);
}

if (!scratch && !existsSync(ENV_FILE)) {
  console.error(
    `${ENV_FILE} is missing.\n` +
      "It holds the deployed database's connection strings and is deliberately\n" +
      "not committed. See docs/RUNBOOK.md for what goes in it, or recover the\n" +
      "values with: npx vercel env pull",
  );
  process.exit(1);
}

if (!scratch) config({ path: ENV_FILE, quiet: true });

const direct = scratch ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!direct) {
  console.error(`${ENV_FILE} sets neither DATABASE_URL_UNPOOLED nor DATABASE_URL.`);
  process.exit(1);
}

/** Host only — never print the password, this output gets pasted into chats. */
const host = (() => {
  try {
    return new URL(direct).host;
  } catch {
    return "(unparseable)";
  }
})();

console.log(scratch ? "TARGET : SCRATCH (read-only proof run)" : `target : ${host}`);
console.log(`db     : ${new URL(direct).pathname.replace("/", "")}`);
console.log(`mode   : APP_MODE=${process.env.APP_MODE ?? "(unset)"}`);

if (!scratch && host.includes(LOCAL_HOST_FRAGMENT)) {
  console.error(
    `\nREFUSING: ${host} is the LOCAL database.\n` +
      `${ENV_FILE} should point at the deployment. Nothing was run.`,
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ check */

if (verb === "check") {
  const client = new pg.Client({ connectionString: direct });
  await client.connect();
  const { rows } = await client.query(`
    select
      (select count(*)::int from users)                                  as users,
      (select count(*)::int from seats)                                  as seats,
      (select count(*)::int from seats where status = 'bookable')        as bookable,
      (select count(*)::int from bookings)                               as bookings,
      (select count(*)::int from meeting_rooms)                          as meeting_rooms,
      (select count(*)::int from seat_releases where revoked_at is null) as live_releases,
      (select count(*)::int from booking_series where status = 'active') as series,
      (select demo_offset_seconds from settings)                         as clock_offset,
      (select count(*)::int from notification_log where status = 'queued') as queued_mail,
      (select count(distinct seat_id)::int from bookings
         where status = 'auto_released' and booking_date = current_date)  as auto_released_today,
      (select count(*)::int from bookings
         where booking_date between (current_date - 14) and current_date
           and status = 'auto_released')                                 as recent_auto_released,
      (select count(*)::int from bookings
         where booking_date between (current_date - 14) and current_date
           and status in ('confirmed','checked_in','completed',
                           'auto_released','completed_no_show'))          as recent_held`);

  /*
   * Which migrations production has actually had applied.
   *
   * Drizzle's migrator stores one row per applied migration carrying the
   * journal entry's own `when` as created_at, so the journal joins to the
   * table on that value.
   *
   * THIS IS THE CHECK THAT WOULD HAVE CAUGHT THE PHASE 6 OUTAGE. bay_code was
   * in schema.ts and in drizzle/0004, journalled and committed -- it had simply
   * never been applied to production, because `npm run db:migrate` reads
   * .env.local. The deploy then promoted code that selected it and every
   * meeting-room query failed with 42703.
   */
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  let applied = [];
  try {
    const appliedRows = await client.query(
      "select created_at from drizzle.__drizzle_migrations",
    );
    const stamps = new Set(appliedRows.rows.map((r) => Number(r.created_at)));
    applied = journal.entries.filter((e) => stamps.has(e.when)).map((e) => e.tag);
  } catch {
    // No migrations table at all is the most severe drift there is, so this
    // reports "none applied" rather than swallowing the error.
    applied = [];
  }
  const migrations = { applied, onDisk: journal.entries.map((e) => e.tag) };

  console.log();
  console.table(rows);
  console.log(
    `migrations: ${applied.length}/${migrations.onDisk.length} applied` +
      (applied.length === migrations.onDisk.length ? "" : "  <- BEHIND"),
  );

  const { failures, warnings } = evaluateProduction(rows[0], migrations);
  await client.end();

  for (const w of warnings) console.log(NL + "! " + w);
  if (failures.length > 0) {
    for (const f of failures) console.error(NL + "FAIL: " + f);
    console.error(
      NL +
        `FAILED: ${failures.length} problem(s). Exits non-zero so it can gate ` +
        `a deploy, which the previous version could not -- it always exited 0, ` +
        `and once reported "looks presentable" against three bookings.`,
    );
    process.exit(1);
  }
  if (warnings.length === 0) console.log(NL + "looks presentable.");
  process.exit(0);
}

/* ----------------------------------------------------------------- write */

if (!confirmed) {
  console.error(
    `\nThis would run "${verb}" against the DEPLOYED database above.\n` +
      `Re-run with --yes-production if that is what you mean.`,
  );
  process.exit(1);
}

console.log(`\nrunning ${VERBS[verb]} …\n`);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", VERBS[verb]],
  { stdio: "inherit", env: { ...process.env, ENV_FILE }, shell: process.platform === "win32" },
);
child.on("exit", (code) => process.exit(code ?? 1));
