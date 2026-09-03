/**
 * Drops and recreates the public schema on the DIRECT endpoint, so migrations
 * can be verified against a genuinely empty database.
 * `npm run db:reset`
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

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
