/**
 * Run the scheduled jobs once, from the command line.
 * `npm run jobs:run`
 *
 * The same function the dev interval and the Vercel cron call. Useful when
 * demonstrating auto-release without waiting for a tick, and for checking what
 * the job would do before letting it loose.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../src/lib/db/schema";
import { DemoClock, SystemClock } from "../src/lib/clock";
import { runScheduledJobs } from "../src/lib/jobs/run-jobs";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });

  const [settings] = await db.select().from(schema.settings).limit(1);
  const clock =
    process.env.APP_MODE === "production"
      ? new SystemClock()
      : new DemoClock(settings?.demoOffsetSeconds ?? 0);

  console.log(`running jobs at ${clock.now().toISOString()}`);
  const result = await runScheduledJobs({ db, clock });
  console.dir(result, { depth: 4 });
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
