import { cookies } from "next/headers";
import { asc, eq } from "drizzle-orm";
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

/**
 * Demo auth: returns whichever seeded user the role switcher cookie names.
 * Real sign-in is Entra ID; see production.ts.
 */
export class DemoAuthProvider implements AuthProvider {
  async currentUser(): Promise<User | null> {
    const jar = await cookies();
    const email = jar.get(ROLE_COOKIE)?.value;

    if (email) {
      const [user] = await db()
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);
      if (user) return user;
      // Fall through: stale cookie, or the database was reseeded under it.
    }

    // No cookie, or it named nobody. Resolve a default from the seed rather
    // than hard-coding an address — seeded names are generated, so any literal
    // here silently rots the moment the roster changes.
    return this.defaultUser();
  }

  private async defaultUser(): Promise<User | null> {
    const [admin] = await db()
      .select()
      .from(schema.users)
      .where(eq(schema.users.isAdmin, true))
      .orderBy(asc(schema.users.email))
      .limit(1);
    if (admin) return admin;

    const [anyone] = await db()
      .select()
      .from(schema.users)
      .orderBy(asc(schema.users.email))
      .limit(1);
    return anyone ?? null;
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
