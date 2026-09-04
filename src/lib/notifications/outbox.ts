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
import { and, eq, sql } from "drizzle-orm";

import { mail as defaultMailer } from "@/lib/adapters";
import type { MailProvider } from "@/lib/adapters/types";
import { SystemClock, type Clock } from "@/lib/clock";
import { db as defaultDb, schema, type Db, type DbLike } from "@/lib/db";
import { JOB_EMITTED_KINDS, type NotificationKind } from "@/lib/notifications/kinds";
import type { RenderedNotification } from "@/lib/notifications/render";

/** Give up after this many tries and leave the row `failed` for a human. */
export const MAX_ATTEMPTS = 3;

/**
 * How long a claimed message is invisible to other runners.
 *
 * Long enough that a slow Graph call cannot have its message stolen mid-send,
 * short enough that a crashed process does not strand a booking confirmation
 * for the rest of the afternoon.
 */
const CLAIM_LEASE_MINUTES = 5;

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
 * Safe to run from the dev interval, a Vercel cron and the demo panel's button
 * at the same time — see the claim below for how, and why the obvious approach
 * is not enough.
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

  /**
   * CLAIM, then send.
   *
   * `SELECT … FOR UPDATE SKIP LOCKED` on its own is not enough here: the lock
   * dies with the transaction, and the transaction has to commit before the
   * send happens (a send can take seconds and must not hold a row lock). Two
   * runners would then select the same rows and send the same email twice —
   * exactly what an outbox exists to prevent, and the dev interval, the Vercel
   * cron and the demo panel's button really can overlap.
   *
   * So the claim is an UPDATE that pushes `next_attempt_at` a lease ahead,
   * atomically, over rows taken with SKIP LOCKED. Whoever wins the update owns
   * them; anybody else skips straight past. If this process dies mid-send the
   * lease expires and the next run picks them up — at-least-once, which is the
   * right trade for a booking confirmation.
   */
  const leaseUntil = new Date(now.getTime() + CLAIM_LEASE_MINUTES * 60_000);
  const claimed = await db.execute<typeof schema.notificationLog.$inferSelect>(sql`
    update ${schema.notificationLog}
       set next_attempt_at = ${leaseUntil}
     where id in (
       select id from ${schema.notificationLog}
        where status = 'queued'
          and (next_attempt_at is null or next_attempt_at <= ${now})
        order by created_at
        limit ${limit}
        for update skip locked
     )
    returning *
  `);
  const due = (claimed.rows ?? []) as Array<typeof schema.notificationLog.$inferSelect>;

  for (const raw of due) {
    // `db.execute` hands back driver rows, which are snake_case.
    const row = raw as unknown as {
      id: string;
      kind: string;
      subject: string;
      body: string;
      attempts: number;
      recipient_email: string;
      booking_id: string | null;
      room_booking_id: string | null;
    };
    result.attempted += 1;
    const attempts = row.attempts + 1;
    try {
      await mailer.send({
        to: row.recipient_email,
        subject: row.subject,
        body: row.body,
        kind: row.kind,
        bookingId: row.booking_id ?? undefined,
        roomBookingId: row.room_booking_id ?? undefined,
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
