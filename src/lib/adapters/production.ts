import type {
  AuthProvider,
  CalendarSync,
  CheckInSource,
  MailProvider,
  OutboundMail,
} from "@/lib/adapters/types";
import type { BadgeEvent, RoomBooking, User } from "@/lib/db/schema";

/**
 * Production stubs. Every method throws, and every TODO names exactly what has
 * to be wired. Deliberately not attempted in Phase 1 — none of these can be
 * built until CBVA's IT gives us tenant access.
 *
 * They throw rather than silently no-op so that running with APP_MODE=production
 * before the wiring exists fails loudly on the first request instead of quietly
 * losing people's bookings.
 */

const notImplemented = (what: string): never => {
  throw new Error(`${what} is not implemented in production mode yet`);
};

export class EntraAuthProvider implements AuthProvider {
  async currentUser(): Promise<User | null> {
    // TODO(phase-5, blocked on CBVA IT): Microsoft Entra ID sign-in.
    //   1. Register the app in the CBVA tenant; obtain client id + tenant id.
    //   2. Add @azure/msal-node confidential client, auth code flow with PKCE.
    //   3. Validate the id_token, map the `preferred_username` claim onto
    //      users.email, and 403 anyone with no matching row (no JIT creation —
    //      grade and seat_mode must come from HR, not from a token).
    //   4. Session cookie: httpOnly, sameSite=lax, secure.
    return notImplemented("Entra ID authentication");
  }
}

export class GraphMailProvider implements MailProvider {
  async send(_msg: OutboundMail): Promise<void> {
    // TODO(phase-3, blocked on CBVA IT): Microsoft Graph sendMail.
    //   POST /users/{workspace-service-account}/sendMail with Mail.Send
    //   application permission and admin consent.
    //   Still write the notification_log row first (status 'queued'), then
    //   update to 'sent'/'failed' with the error — the log is the audit trail
    //   and must not depend on Graph succeeding.
    return notImplemented("Microsoft Graph sendMail");
  }
}

export class GraphCalendarSync implements CalendarSync {
  async upsert(_b: RoomBooking): Promise<string> {
    // TODO(phase-3, blocked on CBVA IT): Microsoft Graph calendar events.
    //   POST/PATCH /users/{meeting_rooms.outlook_resource_email}/events with
    //   Calendars.ReadWrite application permission.
    //   Return event.id and store it in room_bookings.calendar_event_id;
    //   set sync_status accordingly. Needs the room resource mailbox list from
    //   IT — meeting_rooms.outlook_resource_email is null for every row today.
    return notImplemented("Microsoft Graph calendar upsert");
  }

  async remove(_id: string): Promise<void> {
    // TODO(phase-3): DELETE /users/{resource}/events/{id}. Treat 404 as success
    //   so a cancellation is idempotent.
    return notImplemented("Microsoft Graph calendar removal");
  }
}

export class BadgeWebhookCheckInSource implements CheckInSource {
  subscribe(_cb: (e: BadgeEvent) => void): void {
    // TODO(phase-3, blocked on CBVA facilities): badge reader feed.
    //   The access control vendor and its export format are both unknown —
    //   see docs/ASSUMPTIONS.md. Expected shape: an authenticated webhook
    //   POSTing swipes to /api/badge, written into badge_events (already
    //   modelled), with reader_id mapped to a floor. Reconcile against
    //   bookings on (occupant_user_id, swiped_at within slot bounds).
    notImplemented("Badge reader webhook subscription");
  }
}
