/**
 * Applies drizzle/*.sql against the DIRECT (unpooled) endpoint.
 * `npm run db:migrate`
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  console.log("applying migrations from ./drizzle …");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
