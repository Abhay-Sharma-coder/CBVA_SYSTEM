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
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { config } from "dotenv";
import pg from "pg";

const ENV_FILE = ".env.production.local";

/** The local database, so we can refuse to "deploy" onto it by accident. */
const LOCAL_HOST_FRAGMENT = "ep-empty-hall";

const VERBS = {
  check: null, // handled inline
  migrate: "scripts/migrate.ts",
  seed: "scripts/seed.ts",
  jobs: "scripts/run-jobs.ts",
  "backfill-slots": "scripts/backfill-slot-bounds.ts",
};

const verb = process.argv[2];
const confirmed = process.argv.includes("--yes-production");

if (!verb || !(verb in VERBS)) {
  console.error(
    `usage: node scripts/prod.mjs <${Object.keys(VERBS).join("|")}> [--yes-production]`,
  );
  process.exit(1);
}

if (!existsSync(ENV_FILE)) {
  console.error(
    `${ENV_FILE} is missing.\n` +
      "It holds the deployed database's connection strings and is deliberately\n" +
      "not committed. See docs/RUNBOOK.md for what goes in it, or recover the\n" +
      "values with: npx vercel env pull",
  );
  process.exit(1);
}

config({ path: ENV_FILE, quiet: true });

const direct = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
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

console.log(`target : ${host}`);
console.log(`db     : ${new URL(direct).pathname.replace("/", "")}`);
console.log(`mode   : APP_MODE=${process.env.APP_MODE ?? "(unset)"}`);

if (host.includes(LOCAL_HOST_FRAGMENT)) {
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
      (select count(*)::int from seat_releases where revoked_at is null) as live_releases,
      (select count(*)::int from booking_series where status = 'active') as series,
      (select demo_offset_seconds from settings)                         as clock_offset,
      (select count(*)::int from notification_log where status = 'queued') as queued_mail`);
  console.log();
  console.table(rows);

  const o = rows[0];
  const warn = [];
  if (o.clock_offset !== 0)
    warn.push(`clock offset is ${o.clock_offset}s — reset it before a demo`);
  if (o.seats !== 141) warn.push(`${o.seats} seats, expected 141 — test debris?`);
  if (o.users !== 141) warn.push(`${o.users} users, expected 141 — test debris?`);
  if (o.queued_mail > 50) warn.push(`${o.queued_mail} messages queued — is the cron running?`);
  console.log(warn.length ? `\n⚠ ${warn.join("\n⚠ ")}` : "\nlooks presentable.");

  await client.end();
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
