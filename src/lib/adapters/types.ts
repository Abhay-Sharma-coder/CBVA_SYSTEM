import type { BadgeEvent, RoomBooking, User } from "@/lib/db/schema";

/**
 * THE ADAPTER BOUNDARY
 *
 * Four integrations CBVA cannot connect yet: Entra ID sign-in, Microsoft Graph
 * sendMail, Graph calendar events, and the physical badge reader feed.
 *
 * Each gets an interface here, a demo implementation and a production stub,
 * selected by the single env var APP_MODE. Booking logic imports the interface
 * and must never be able to tell which implementation is live — that is what
 * makes the demo an honest rehearsal of production rather than a mock-up.
 */

export interface AuthProvider {
  currentUser(): Promise<User | null>;
}

export interface OutboundMail {
  to: string;
  subject: string;
  body: string;
  /** Correlates the message with the row that triggered it, for the log. */
  kind: string;
  bookingId?: string;
  roomBookingId?: string;
}

export interface MailProvider {
  send(msg: OutboundMail): Promise<void>;
}

export interface CalendarSync {
  /** Returns the external calendar event id. */
  upsert(b: RoomBooking): Promise<string>;
  remove(id: string): Promise<void>;
}

export interface CheckInSource {
  subscribe(cb: (e: BadgeEvent) => void): void;
}

export interface Adapters {
  auth: AuthProvider;
  mail: MailProvider;
  calendar: CalendarSync;
  checkIn: CheckInSource;
}
