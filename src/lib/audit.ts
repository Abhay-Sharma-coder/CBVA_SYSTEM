/**
 * One writer for audit_log.
 *
 * Every state change writes a row. Having a single function means the entity
 * and action vocabularies stay closed enough to query — `audit_log.action` is
 * free text in the schema, and free text with four call sites becomes four
 * spellings of the same verb within a phase.
 */
import { schema, type DbLike } from "@/lib/db";

export type AuditEntity = "bookings" | "room_bookings" | "seats" | "users" | "settings"
  | "seat_releases"
  | "booking_series";

export type AuditAction =
  | "create"
  | "edit"
  | "cancel"
  | "check_in"
  | "auto_release"
  | "complete"
  | "no_show"
  | "force_cancel"
  | "update_geometry"
  | "update_status"
  | "deactivate"
  | "activate"
  | "update_settings"
  | "calendar_sync"
  | "calendar_sync_failed"
  | "release_seat"
  | "revoke_release"
  | "create_series"
  | "cancel_series"
  | "materialise"
  | "auto_release_capped"
  | "update_user";

export interface AuditEntry {
  actorUserId: string | null;
  entity: AuditEntity;
  entityId: string | null;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
}

export async function writeAudit(db: DbLike, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLog).values({
    actorUserId: entry.actorUserId,
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before === undefined ? null : (entry.before as object),
    after: entry.after === undefined ? null : (entry.after as object),
  });
}

export async function writeAuditMany(db: DbLike, entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(schema.auditLog).values(
    entries.map((entry) => ({
      actorUserId: entry.actorUserId,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      before: entry.before === undefined ? null : (entry.before as object),
      after: entry.after === undefined ? null : (entry.after as object),
    })),
  );
}
