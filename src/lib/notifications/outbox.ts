/**
 * The outbox: enqueue, then dispatch.
 *
 * `notification_log` is the queue, not a log of what a provider already did.
 * That inversion is the whole design. Enqueuing happens INSIDE the booking
 * transaction, so a committed booking always has its notification row and a
 * crash can never leave one without the other. Sending happens AFTER the commit
 * and its failures are swallowed, so no delivery problem — a Graph outage, a
 * throttled tenant, a wrong address — can ever roll back a booking.
 *
 * `MailProvider` is therefore only a transport. The demo implementation does
 * not write rows any more; the queue owns them, and /admin/notifications reads
 * them. Swapping in Graph in production changes who delivers, not who records.
 */
import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";

import { mail as defaultMailer } from "@/lib/adapters";
import type { MailProvider } from "@/lib/adapters/types";
import { SystemClock, type Clock } from "@/lib/clock";
import { db as defaultDb, schema, type Db, type DbLike } from "@/lib/db";
import { JOB_EMITTED_KINDS, type NotificationKind } from "@/lib/notifications/kinds";
import type { RenderedNotification } from "@/lib/notifications/render";

/** Give up after this many tries and leave the row `failed` for a human. */
export const MAX_ATTEMPTS = 3;

/** Backoff between attempts, in minutes: ~1 min, then 5, then 25. */
function backoffMinutes(attempts: number): number {
  return Math.min(60, 5 ** Math.max(0, attempts - 1));
}

export interface EnqueueInput {
  kind: NotificationKind;
  to: string;
  rendered: RenderedNotification;
  bookingId?: string | null;
  roomBookingId?: string | null;
}

/**
 * Queues one message. Call inside the transaction that creates the thing being
 * notified about.
 *
 * Job-emitted kinds carry a partial unique index, so a job that runs twice
 * conflicts on the second insert instead of sending a duplicate. That conflict
 * is swallowed here rather than raised: "this was already queued" is the
 * correct outcome for an idempotent job, not an error.
 */
export async function enqueueNotification(db: DbLike, input: EnqueueInput): Promise<void> {
  const insert = db.insert(schema.notificationLog).values({
    kind: input.kind,
    bookingId: input.bookingId ?? null,
    roomBookingId: input.roomBookingId ?? null,
    recipientEmail: input.to,
    subject: input.rendered.subject,
    body: input.rendered.html,
    channel: "email",
    status: "queued",
    attempts: 0,
    nextAttemptAt: null,
  });

  if (JOB_EMITTED_KINDS.has(input.kind)) {
    await insert.onConflictDoNothing();
    return;
  }
  await insert;
}

export interface DispatchResult {
  attempted: number;
  sent: number;
  failed: number;
}

export interface DispatchOptions {
  db?: Db;
  clock?: Clock;
  /** Injected so a test can prove that a send failure does not lose a booking. */
  mailer?: MailProvider;
  limit?: number;
}

/**
 * Sends whatever is due.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes this safe to run from the dev
 * interval, a Vercel cron and an admin button at the same time: two runners
 * take disjoint sets of rows rather than both sending the same email.
 */
export async function dispatchNotifications(
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const db = options.db ?? defaultDb();
  const clock = options.clock ?? new SystemClock();
  const mailer = options.mailer ?? defaultMailer();
  const limit = options.limit ?? 50;
  const now = clock.now();

  const result: DispatchResult = { attempted: 0, sent: 0, failed: 0 };

  const due = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.notificationLog)
      .where(
        and(
          eq(schema.notificationLog.status, "queued"),
          or(
            isNull(schema.notificationLog.nextAttemptAt),
            lte(schema.notificationLog.nextAttemptAt, now),
          ),
        ),
      )
      .orderBy(asc(schema.notificationLog.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    return rows;
  });

  for (const row of due) {
    result.attempted += 1;
    const attempts = row.attempts + 1;
    try {
      await mailer.send({
        to: row.recipientEmail,
        subject: row.subject,
        body: row.body,
        kind: row.kind,
        bookingId: row.bookingId ?? undefined,
        roomBookingId: row.roomBookingId ?? undefined,
      });
      await db
        .update(schema.notificationLog)
        .set({
          status: "sent",
          attempts,
          sentAt: clock.now(),
          nextAttemptAt: null,
          error: null,
        })
        .where(eq(schema.notificationLog.id, row.id));
      result.sent += 1;
    } catch (err) {
      // A delivery failure is a fact about the message, never about the
      // booking. It is recorded on the row and retried; nothing propagates.
      const exhausted = attempts >= MAX_ATTEMPTS;
      await db
        .update(schema.notificationLog)
        .set({
          status: exhausted ? "failed" : "queued",
          attempts,
          error: err instanceof Error ? err.message : String(err),
          nextAttemptAt: exhausted
            ? null
            : new Date(clock.now().getTime() + backoffMinutes(attempts) * 60_000),
        })
        .where(eq(schema.notificationLog.id, row.id));
      result.failed += 1;
    }
  }

  return result;
}

/**
 * Puts a `failed` row back in the queue. The retry button in the demo inbox.
 */
export async function requeueNotification(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(schema.notificationLog)
    .set({ status: "queued", nextAttemptAt: null, error: null, attempts: 0 })
    .where(and(eq(schema.notificationLog.id, id), eq(schema.notificationLog.status, "failed")))
    .returning({ id: schema.notificationLog.id });
  return rows.length > 0;
}

/**
 * Fire-and-forget dispatch after a write commits.
 *
 * Deliberately not awaited by callers and deliberately swallowing everything:
 * the booking is already committed and the queue will pick the message up on
 * the next job run regardless. The only thing an unhandled rejection here could
 * achieve is turning a delivered booking into a 500.
 */
export function dispatchSoon(options: DispatchOptions = {}): void {
  void dispatchNotifications(options).catch(() => {
    /* the job run will retry */
  });
}

/** Count of what is waiting — for the admin inbox header. */
export async function outboxCounts(db: Db): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: schema.notificationLog.status, n: sql<number>`count(*)::int` })
    .from(schema.notificationLog)
    .groupBy(schema.notificationLog.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
