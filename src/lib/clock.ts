/**
 * THE CLOCK RULE
 *
 * Business logic never calls `new Date()` or `Date.now()`. It takes a Clock and
 * asks it for the time. This file is the ONLY place in src/ allowed to read the
 * system clock; eslint.config.mjs enforces that.
 *
 * Why it is worth the discipline: the demo has to show the 2-hour auto-release
 * rule actually working. With this pattern, an "advance the clock 2 hours"
 * control shifts the demo clock and the REAL auto-release job runs the REAL
 * rule against real rows and really releases the seat. The demo proves
 * production behaviour instead of faking it — and every time-dependent test
 * becomes deterministic for free.
 *
 * The demo offset lives in settings.demo_offset_seconds rather than in memory
 * so that the server and the browser agree on "now", and so the offset survives
 * a page refresh and a server restart.
 */
import { eq } from "drizzle-orm";
import { serverEnv } from "@/lib/config";

export interface Clock {
  now(): Date;
}

/** Real time. Production. */
export class SystemClock implements Clock {
  now(): Date {
    // eslint-disable-next-line no-restricted-syntax -- the one sanctioned read.
    return new Date();
  }
}

/**
 * Real time plus a shared offset. The offset is supplied by the caller rather
 * than fetched here so that this class stays synchronous, pure and usable on
 * both the server and the client.
 */
export class DemoClock implements Clock {
  constructor(
    private readonly offsetSeconds: number,
    private readonly base: Clock = new SystemClock(),
  ) {}

  now(): Date {
    return new Date(this.base.now().getTime() + this.offsetSeconds * 1000);
  }

  get offset(): number {
    return this.offsetSeconds;
  }
}

/* ------------------------------------------------------- server-side access */

/**
 * Reads the shared demo offset and returns the Clock for the current APP_MODE.
 * Server only — it touches the database.
 */
export async function getClock(): Promise<Clock> {
  const { appMode } = serverEnv();
  if (appMode === "production") return new SystemClock();
  return new DemoClock(await readDemoOffsetSeconds());
}

export async function readDemoOffsetSeconds(): Promise<number> {
  const { db, schema } = await import("@/lib/db");
  const [row] = await db()
    .select({ offset: schema.settings.demoOffsetSeconds })
    .from(schema.settings)
    .limit(1);
  return row?.offset ?? 0;
}

/**
 * Shifts the shared demo clock. Used by the demo control in the app shell and,
 * from Phase 3, by the auto-release demonstration.
 */
export async function advanceDemoClock(bySeconds: number): Promise<number> {
  const { db, schema } = await import("@/lib/db");
  const [row] = await db().select().from(schema.settings).limit(1);
  if (!row) throw new Error("settings row missing — run `npm run seed`");
  const next = row.demoOffsetSeconds + bySeconds;
  await db()
    .update(schema.settings)
    .set({ demoOffsetSeconds: next })
    .where(eq(schema.settings.id, row.id));
  return next;
}

export async function resetDemoClock(): Promise<void> {
  const { db, schema } = await import("@/lib/db");
  const [row] = await db().select().from(schema.settings).limit(1);
  if (!row) return;
  await db()
    .update(schema.settings)
    .set({ demoOffsetSeconds: 0 })
    .where(eq(schema.settings.id, row.id));
}
