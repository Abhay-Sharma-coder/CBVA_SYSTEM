import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ------------------------------------------------------------------ enums */

export const gradeEnum = pgEnum("grade", [
  "partner",
  "director",
  "manager",
  "assistant_manager",
  "article",
  "admin_staff",
]);

export const seatModeEnum = pgEnum("seat_mode", ["fixed", "bookable"]);

export const seatTypeEnum = pgEnum("seat_type", [
  "workstation",
  "passage",
  "foldable",
  "cabin",
]);

export const seatStatusEnum = pgEnum("seat_status", [
  "bookable",
  "fixed",
  "blocked",
  "decommissioned",
]);

export const slotEnum = pgEnum("slot", ["AM", "PM"]);

export const bookingStatusEnum = pgEnum("booking_status", [
  "confirmed",
  "checked_in",
  "cancelled_by_user",
  "auto_released",
  "completed",
  "completed_no_show",
]);

export const bookingSourceEnum = pgEnum("booking_source", [
  "self",
  "on_behalf",
  "admin",
]);

export const roomBookingStatusEnum = pgEnum("room_booking_status", [
  "confirmed",
  "cancelled",
  "completed",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "pending",
  "synced",
  "failed",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "queued",
  "sent",
  "failed",
]);

/* ------------------------------------------------------------------ tables */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    grade: gradeEnum("grade").notNull(),
    team: text("team"),
    seatMode: seatModeEnum("seat_mode").notNull().default("bookable"),
    // FK added in the constraints migration: seats and users reference each
    // other, so one direction has to be wired after both tables exist.
    fixedSeatId: uuid("fixed_seat_id"),
    isAdmin: boolean("is_admin").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_grade_idx").on(t.grade),
    index("users_seat_mode_idx").on(t.seatMode),
  ],
);

export const floors = pgTable("floors", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: integer("number").notNull(),
  name: text("name").notNull(),
  /** Key into assets/cad — the plan SVG this floor renders from in Phase 2. */
  planAssetKey: text("plan_asset_key"),
  isActive: boolean("is_active").notNull().default(true),
});

export const zones = pgTable(
  "zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    floorId: uuid("floor_id")
      .notNull()
      .references(() => floors.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("zones_floor_code_unique").on(t.floorId, t.code)],
);

export const seats = pgTable(
  "seats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => zones.id, { onDelete: "restrict" }),
    floorId: uuid("floor_id")
      .notNull()
      .references(() => floors.id, { onDelete: "restrict" }),
    seatCode: text("seat_code").notNull(),
    bay: text("bay").notNull(),
    /**
     * Plan coordinate space, not pixels. Phase 1 seeds a temporary grid;
     * Phase 2 overwrites both from the CAD extraction in tools/cad/.
     */
    planX: numeric("plan_x", { precision: 10, scale: 2 }).notNull(),
    planY: numeric("plan_y", { precision: 10, scale: 2 }).notNull(),
    rotationDeg: integer("rotation_deg").notNull().default(0),
    seatType: seatTypeEnum("seat_type").notNull().default("workstation"),
    status: seatStatusEnum("status").notNull().default("bookable"),
    assignedUserId: uuid("assigned_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    amenities: jsonb("amenities").notNull().default(sql`'{}'::jsonb`),
    activeFrom: date("active_from").notNull(),
    activeTo: date("active_to"),
  },
  (t) => [
    uniqueIndex("seats_seat_code_unique").on(t.seatCode),
    index("seats_zone_idx").on(t.zoneId),
    index("seats_bay_idx").on(t.bay),
    index("seats_status_idx").on(t.status),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id, { onDelete: "restrict" }),
    bookingDate: date("booking_date").notNull(),
    slot: slotEnum("slot").notNull(),
    /**
     * Derived from bookingDate + slot via deriveSlotBounds() in
     * src/lib/slots.ts. Stored so the auto-release job can range-scan without
     * re-deriving. Never write these by hand.
     */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    bookedByUserId: uuid("booked_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    occupantUserId: uuid("occupant_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: bookingStatusEnum("status").notNull().default("confirmed"),
    source: bookingSourceEnum("source").notNull().default("self"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // NOTE: the uniqueness rule that actually matters (one active booking per
    // seat/date/slot) is a PARTIAL unique index and lives in the hand-written
    // migration drizzle/0001_constraints.sql. Drizzle cannot express the
    // predicate, and it must not be duplicated at app level.
    index("bookings_date_idx").on(t.bookingDate),
    index("bookings_seat_date_idx").on(t.seatId, t.bookingDate),
    index("bookings_occupant_idx").on(t.occupantUserId),
    index("bookings_status_idx").on(t.status),
    index("bookings_starts_at_idx").on(t.startsAt),
  ],
);

export const meetingRooms = pgTable(
  "meeting_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    floorId: uuid("floor_id")
      .notNull()
      .references(() => floors.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    amenities: jsonb("amenities").notNull().default(sql`'{}'::jsonb`),
    /** Outlook room resource mailbox. Null until IT gives us the list. */
    outlookResourceEmail: text("outlook_resource_email"),
    isBookable: boolean("is_bookable").notNull().default(true),
  },
  (t) => [uniqueIndex("meeting_rooms_name_unique").on(t.name)],
);

export const roomBookings = pgTable(
  "room_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => meetingRooms.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    organiserUserId: uuid("organiser_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    status: roomBookingStatusEnum("status").notNull().default("confirmed"),
    calendarEventId: text("calendar_event_id"),
    syncStatus: syncStatusEnum("sync_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Overlap prevention is a GiST exclusion constraint in
    // drizzle/0001_constraints.sql. Rooms are arbitrary ranges, not slots.
    index("room_bookings_room_starts_idx").on(t.roomId, t.startsAt),
    index("room_bookings_starts_at_idx").on(t.startsAt),
  ],
);

/**
 * Stub table. No badge feed exists yet; CheckInSource writes here in demo mode
 * so a real reader webhook can land later with no schema change.
 */
export const badgeEvents = pgTable(
  "badge_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    swipedAt: timestamp("swiped_at", { withTimezone: true }).notNull(),
    readerId: text("reader_id"),
    raw: jsonb("raw").notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("badge_events_user_swiped_idx").on(t.userId, t.swipedAt)],
);

export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    roomBookingId: uuid("room_booking_id").references(() => roomBookings.id, {
      onDelete: "set null",
    }),
    recipientEmail: text("recipient_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    channel: text("channel").notNull().default("email"),
    status: notificationStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    index("notification_log_kind_idx").on(t.kind),
    index("notification_log_status_idx").on(t.status),
  ],
);

export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    holidayDate: date("holiday_date").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("holidays_date_unique").on(t.holidayDate)],
);

/**
 * Singleton. Exactly one row, enforced by settings_singleton in the
 * constraints migration.
 */
export const settings = pgTable("settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingWindowDays: integer("booking_window_days").notNull().default(14),
  slotDefinitions: jsonb("slot_definitions").notNull(),
  autoReleaseMinutes: integer("auto_release_minutes").notNull().default(120),
  cutoffMinutes: integer("cutoff_minutes").notNull().default(60),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  /**
   * DemoClock offset. Held here rather than in memory so server and client
   * agree and the offset survives a page refresh — see src/lib/clock.ts.
   */
  demoOffsetSeconds: integer("demo_offset_seconds").notNull().default(0),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

/* ------------------------------------------------------------------ types */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Seat = typeof seats.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type MeetingRoom = typeof meetingRooms.$inferSelect;
export type RoomBooking = typeof roomBookings.$inferSelect;
export type NewRoomBooking = typeof roomBookings.$inferInsert;
export type BadgeEvent = typeof badgeEvents.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Grade = (typeof gradeEnum.enumValues)[number];
export type Slot = (typeof slotEnum.enumValues)[number];
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];
export type SeatStatus = (typeof seatStatusEnum.enumValues)[number];
