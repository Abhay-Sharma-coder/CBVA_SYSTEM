/**
 * Drops and recreates the public schema on the DIRECT endpoint, so migrations
 * can be verified against a genuinely empty database.
 * `npm run db:reset`
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

import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");

  const pool = new Pool({ connectionString: url, max: 1 });
  console.log("dropping schema public + drizzle …");
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await pool.query("CREATE SCHEMA public");
  console.log("empty database ready");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
