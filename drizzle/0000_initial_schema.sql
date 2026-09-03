CREATE TYPE "public"."booking_source" AS ENUM('self', 'on_behalf', 'admin');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'checked_in', 'cancelled_by_user', 'auto_released', 'completed', 'completed_no_show');--> statement-breakpoint
CREATE TYPE "public"."grade" AS ENUM('partner', 'director', 'manager', 'assistant_manager', 'article', 'admin_staff');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."room_booking_status" AS ENUM('confirmed', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."seat_mode" AS ENUM('fixed', 'bookable');--> statement-breakpoint
CREATE TYPE "public"."seat_status" AS ENUM('bookable', 'fixed', 'blocked', 'decommissioned');--> statement-breakpoint
CREATE TYPE "public"."seat_type" AS ENUM('workstation', 'passage', 'foldable', 'cabin');--> statement-breakpoint
CREATE TYPE "public"."slot" AS ENUM('AM', 'PM');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'synced', 'failed');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badge_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"swiped_at" timestamp with time zone NOT NULL,
	"reader_id" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seat_id" uuid NOT NULL,
	"booking_date" date NOT NULL,
	"slot" "slot" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"booked_by_user_id" uuid NOT NULL,
	"occupant_user_id" uuid NOT NULL,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"source" "booking_source" DEFAULT 'self' NOT NULL,
	"checked_in_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"plan_asset_key" text,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"amenities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outlook_resource_email" text,
	"is_bookable" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"booking_id" uuid,
	"room_booking_id" uuid,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "room_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"organiser_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "room_booking_status" DEFAULT 'confirmed' NOT NULL,
	"calendar_event_id" text,
	"sync_status" "sync_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"floor_id" uuid NOT NULL,
	"seat_code" text NOT NULL,
	"bay" text NOT NULL,
	"plan_x" numeric(10, 2) NOT NULL,
	"plan_y" numeric(10, 2) NOT NULL,
	"rotation_deg" integer DEFAULT 0 NOT NULL,
	"seat_type" "seat_type" DEFAULT 'workstation' NOT NULL,
	"status" "seat_status" DEFAULT 'bookable' NOT NULL,
	"assigned_user_id" uuid,
	"amenities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_from" date NOT NULL,
	"active_to" date
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_window_days" integer DEFAULT 14 NOT NULL,
	"slot_definitions" jsonb NOT NULL,
	"auto_release_minutes" integer DEFAULT 120 NOT NULL,
	"cutoff_minutes" integer DEFAULT 60 NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"demo_offset_seconds" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"grade" "grade" NOT NULL,
	"team" text,
	"seat_mode" "seat_mode" DEFAULT 'bookable' NOT NULL,
	"fixed_seat_id" uuid,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"floor_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_events" ADD CONSTRAINT "badge_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_seat_id_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."seats"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_booked_by_user_id_users_id_fk" FOREIGN KEY ("booked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_occupant_user_id_users_id_fk" FOREIGN KEY ("occupant_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_rooms" ADD CONSTRAINT "meeting_rooms_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_room_booking_id_room_bookings_id_fk" FOREIGN KEY ("room_booking_id") REFERENCES "public"."room_bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_room_id_meeting_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."meeting_rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_organiser_user_id_users_id_fk" FOREIGN KEY ("organiser_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "badge_events_user_swiped_idx" ON "badge_events" USING btree ("user_id","swiped_at");--> statement-breakpoint
CREATE INDEX "bookings_date_idx" ON "bookings" USING btree ("booking_date");--> statement-breakpoint
CREATE INDEX "bookings_seat_date_idx" ON "bookings" USING btree ("seat_id","booking_date");--> statement-breakpoint
CREATE INDEX "bookings_occupant_idx" ON "bookings" USING btree ("occupant_user_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bookings_starts_at_idx" ON "bookings" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_date_unique" ON "holidays" USING btree ("holiday_date");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_rooms_name_unique" ON "meeting_rooms" USING btree ("name");--> statement-breakpoint
CREATE INDEX "notification_log_kind_idx" ON "notification_log" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "notification_log_status_idx" ON "notification_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "room_bookings_room_starts_idx" ON "room_bookings" USING btree ("room_id","starts_at");--> statement-breakpoint
CREATE INDEX "room_bookings_starts_at_idx" ON "room_bookings" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seats_seat_code_unique" ON "seats" USING btree ("seat_code");--> statement-breakpoint
CREATE INDEX "seats_zone_idx" ON "seats" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "seats_bay_idx" ON "seats" USING btree ("bay");--> statement-breakpoint
CREATE INDEX "seats_status_idx" ON "seats" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_grade_idx" ON "users" USING btree ("grade");--> statement-breakpoint
CREATE INDEX "users_seat_mode_idx" ON "users" USING btree ("seat_mode");--> statement-breakpoint
CREATE UNIQUE INDEX "zones_floor_code_unique" ON "zones" USING btree ("floor_id","code");