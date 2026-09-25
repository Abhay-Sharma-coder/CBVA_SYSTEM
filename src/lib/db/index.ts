import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { serverEnv } from "@/lib/config";
import * as schema from "./schema";

export * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/** Anything you can run a statement on: a pool handle or a transaction. */
export type DbLike = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

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
  const created = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });

  /**
   * WITHOUT THIS LISTENER, A DROPPED CONNECTION KILLS THE PROCESS.
   *
   * `pg` emits `error` on an idle client when the server goes away — Neon
   * suspending an idle compute, a laptop's wifi blinking, a DNS lookup failing.
   * `error` is one of Node's special-cased events: unhandled, it is not
   * swallowed, it is rethrown as an uncaughtException. So a blip that the pool
   * is perfectly capable of recovering from by opening a new connection instead
   * took the whole dev server down.
   *
   * Twice in one afternoon a transient `getaddrinfo ENOTFOUND …neon.tech`
   * turned into `uncaughtException: Connection terminated unexpectedly` and
   * every test after it failed. The same blip during a demo would end the demo.
   *
   * The pool discards the broken client and opens a fresh one on the next
   * checkout; there is nothing to do here but decline to die. It is logged
   * rather than silenced, because a pool erroring repeatedly is worth seeing.
   */
  created.on("error", (err) => {
    console.error("[db] idle client error, discarding connection:", err.message);
  });

  return created;
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
