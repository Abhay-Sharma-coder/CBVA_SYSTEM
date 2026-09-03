import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { serverEnv } from "@/lib/config";
import * as schema from "./schema";

export * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

/**
 * Two pools, deliberately.
 *
 * `db()` uses Neon's pooled (PgBouncer) endpoint — right for short request-scoped
 * queries from the Next.js runtime.
 *
 * `directDb()` uses the unpooled endpoint. Migrations, the seed script and the
 * constraint tests need session-scoped transactions; PgBouncer transaction
 * pooling breaks DDL sequencing and makes the concurrency tests flaky.
 */
const globalPools = globalThis as unknown as {
  __cbvaPool?: Pool;
  __cbvaDirectPool?: Pool;
};

function makePool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
}

export function pool(): Pool {
  globalPools.__cbvaPool ??= makePool(serverEnv().databaseUrl);
  return globalPools.__cbvaPool;
}

export function directPool(): Pool {
  globalPools.__cbvaDirectPool ??= makePool(serverEnv().databaseUrlDirect);
  return globalPools.__cbvaDirectPool;
}

let cachedDb: Db | null = null;
let cachedDirectDb: Db | null = null;

export function db(): Db {
  cachedDb ??= drizzle(pool(), { schema });
  return cachedDb;
}

export function directDb(): Db {
  cachedDirectDb ??= drizzle(directPool(), { schema });
  return cachedDirectDb;
}

export async function closePools(): Promise<void> {
  await Promise.all([
    globalPools.__cbvaPool?.end(),
    globalPools.__cbvaDirectPool?.end(),
  ]);
  globalPools.__cbvaPool = undefined;
  globalPools.__cbvaDirectPool = undefined;
  cachedDb = null;
  cachedDirectDb = null;
}
