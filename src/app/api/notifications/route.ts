import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { handle, routeContext } from "@/lib/api";
import { assertAdmin } from "@/lib/booking/authorise";
import { schema } from "@/lib/db";
import { outboxCounts } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";

/**
 * The demo inbox. Every message the product has produced, as it would have been
 * sent — which is what makes the notification flow demonstrable with no SMTP
 * anywhere, and means production is an adapter swap rather than a rewrite.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const ctx = await routeContext();
    assertAdmin(ctx.actor);

    const params = new URL(request.url).searchParams;
    const kind = params.get("kind");
    const status = params.get("status");

    const where = [];
    if (kind) where.push(eq(schema.notificationLog.kind, kind));
    if (status === "queued" || status === "sent" || status === "failed") {
      where.push(eq(schema.notificationLog.status, status));
    }

    const rows = await ctx.db
      .select({
        id: schema.notificationLog.id,
        kind: schema.notificationLog.kind,
        recipientEmail: schema.notificationLog.recipientEmail,
        subject: schema.notificationLog.subject,
        body: schema.notificationLog.body,
        status: schema.notificationLog.status,
        attempts: schema.notificationLog.attempts,
        error: schema.notificationLog.error,
        createdAt: schema.notificationLog.createdAt,
        sentAt: schema.notificationLog.sentAt,
        nextAttemptAt: schema.notificationLog.nextAttemptAt,
        bookingId: schema.notificationLog.bookingId,
        roomBookingId: schema.notificationLog.roomBookingId,
      })
      .from(schema.notificationLog)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.notificationLog.createdAt))
      .limit(200);

    return NextResponse.json({
      counts: await outboxCounts(ctx.db),
      messages: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        sentAt: r.sentAt?.toISOString() ?? null,
        nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
      })),
    });
  });
}
