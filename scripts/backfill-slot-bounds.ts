/**
 * Recompute bookings.starts_at / ends_at from the slot definitions now in
 * settings. `npx tsx scripts/backfill-slot-bounds.ts [--history]`
 *
 * ADR-007 warned that these stored derived columns go stale the moment a slot
 * boundary is edited. The settings editor backfills automatically, in the same
 * transaction as the change; this exists for the other case — a settings row
 * edited by hand, or a database restored from before a boundary change.
 *
 * By default it touches only live bookings. `--history` also rewrites finished
 * ones, which is usually wrong: a booking that happened between 09:00 and 13:30
 * happened then, whatever the slot means today.
 */
import { config } from "dotenv";
/**
 * Which env file to load.
 *
 * Defaults to `.env.local` (the LOCAL / test database). Set ENV_FILE to point
 * at another — `scripts/prod.mjs` sets it to `.env.production.local` so the
 * same script can be aimed at the deployed database without editing anything.
 *
 * dotenv does not override variables already in the environment, so an
 * explicitly exported DATABASE_URL still wins over both files.
 */
config({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { backfillSlotBounds } from "../src/lib/admin/settings-service";
import * as schema from "../src/lib/db/schema";
import { getSettings } from "../src/lib/settings";

async function main() {
  const includeHistory = process.argv.includes("--history");
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");

  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });

  const settings = await getSettings(db);
  console.log(
    `slots in force: ${settings.slotDefinitions
      .map((d) => `${d.key} ${d.start}-${d.end}`)
      .join(", ")}`,
  );

  const changed = await backfillSlotBounds(db, settings.slotDefinitions, settings.timezone, {
    includeHistory,
    now: new Date(),
  });
  console.log(
    `${changed} booking${changed === 1 ? "" : "s"} rewritten${includeHistory ? " (including history)" : ""}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
