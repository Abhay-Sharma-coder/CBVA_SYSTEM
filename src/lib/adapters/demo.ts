import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SystemClock } from "@/lib/clock";
import type {
  AuthProvider,
  CalendarSync,
  CheckInSource,
  MailProvider,
  OutboundMail,
} from "@/lib/adapters/types";
import type { BadgeEvent, RoomBooking, User } from "@/lib/db/schema";

/** Cookie the role switcher writes. Value is a seeded user's email. */
export const ROLE_COOKIE = "cbva_role";

/** Who you are when no cookie is set — a partner, so the shell has full nav. */
export const DEFAULT_DEMO_EMAIL = "priya.deshmukh@cbva.in";

/**
 * Demo auth: returns whichever seeded user the role switcher cookie names.
 * Real sign-in is Entra ID; see production.ts.
 */
export class DemoAuthProvider implements AuthProvider {
  async currentUser(): Promise<User | null> {
    const jar = await cookies();
    const email = jar.get(ROLE_COOKIE)?.value ?? DEFAULT_DEMO_EMAIL;
    const [user] = await db()
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (user) return user;

    // The cookie names someone who is not seeded (stale cookie, reseeded db).
    const [fallback] = await db()
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, DEFAULT_DEMO_EMAIL))
      .limit(1);
    return fallback ?? null;
  }
}

/**
 * Demo mail: writes to notification_log and stops. Nothing leaves the machine.
 * The Admin screen in Phase 5 reads this table as an outbox, which is how we
 * demonstrate the notification content without sending anything to real staff.
 */
export class DemoMailProvider implements MailProvider {
  async send(msg: OutboundMail): Promise<void> {
    await db()
      .insert(schema.notificationLog)
      .values({
        kind: msg.kind,
        bookingId: msg.bookingId ?? null,
        roomBookingId: msg.roomBookingId ?? null,
        recipientEmail: msg.to,
        subject: msg.subject,
        body: msg.body,
        channel: "email",
        status: "sent",
        attempts: 1,
        sentAt: new SystemClock().now(),
      });
  }
}

/** Demo calendar: a plausible-looking fake event id, marked as such. */
export class DemoCalendarSync implements CalendarSync {
  async upsert(b: RoomBooking): Promise<string> {
    return b.calendarEventId ?? `demo-evt-${crypto.randomUUID()}`;
  }

  async remove(_id: string): Promise<void> {
    // No external calendar to remove from in demo mode.
  }
}

/**
 * Demo check-in: no badge hardware, so the UI "Simulate Badge Swipe" button
 * pushes events through here. The subscriber contract is identical to the one a
 * real webhook will satisfy, so Phase 3's check-in handler never changes.
 */
export class DemoCheckInSource implements CheckInSource {
  private readonly subscribers: Array<(e: BadgeEvent) => void> = [];

  subscribe(cb: (e: BadgeEvent) => void): void {
    this.subscribers.push(cb);
  }

  /** Demo-only entry point, called by the badge-swipe API route. */
  emit(e: BadgeEvent): void {
    for (const cb of this.subscribers) cb(e);
  }
}
