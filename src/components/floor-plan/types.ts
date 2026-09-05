import type { SeatVisualStatus } from "@/components/seat/seat-status";
import type { AnchorSource } from "@/lib/floorplan-schema";
import type { SeatDbStatus } from "@/lib/seat-visual-status";

/**
 * One seat, as the floor plan renders it.
 *
 * This is the contract Phase 4's 3D view renders from too — the same array,
 * the same store. Position is data; 2D versus 3D is a rendering choice, so
 * nothing here may leak a 2D assumption.
 */
export interface FloorPlanSeat {
  seatCode: string;
  bay: string;
  zone: "A" | "B" | "C" | "D";
  planX: number;
  planY: number;
  rotationDeg: number;
  seatType: "workstation" | "passage" | "foldable" | "cabin";
  seatStatus: SeatDbStatus;
  /** Resolved for the viewer, date and slot on screen. */
  status: SeatVisualStatus;
  /**
   * Occupant name, or the allocated name on a fixed desk. Null when free — and
   * also null when the viewer is signed out, or when the occupant has opted out
   * of the coworker roster. The desk still reads as held either way; only the
   * label goes, so no occupancy number depends on anybody's privacy choice.
   */
  occupantName: string | null;
  /**
   * This desk is allocated to somebody who has handed it back for the slot on
   * screen. Not a status — it already renders as available or booked through
   * the ordinary paths — just the reason a partner's desk is bookable today.
   */
  releasedByOwner: boolean;
  /**
   * The viewer's OWN booking on this desk, when there is one. Null otherwise —
   * including when somebody else has it, because nothing on the plan needs the
   * identifier of a booking it cannot change.
   *
   * Carried on the seat so the dialog can cancel or edit straight from the plan
   * rather than fetching the booking again on open.
   */
  bookingId: string | null;
  /** The optimistic-lock value for that booking. */
  bookingUpdatedAt: string | null;
  /** How the position was arrived at. Surfaced in the editor, not on /floor. */
  anchorSource: AnchorSource;
}

export interface BookableDay {
  /** yyyy-MM-dd in Asia/Kolkata. */
  date: string;
  weekdayLabel: string;
  dayLabel: string;
  monthLabel: string;
  isToday: boolean;
}

/**
 * A key into settings.slot_definitions — "AM", "PM", or "H09" if CBVA ever
 * switches to hourly. Deliberately not a union: the vocabulary is data, and a
 * closed type here would put the refactor back that ADR-020 removed.
 */
export type SlotKey = string;

export type { SlotDefinition } from "@/lib/slots";

export interface FloorPlanPayload {
  date: string;
  slot: SlotKey;
  seats: FloorPlanSeat[];
  occupied: number;
  capacity: number;
  viewerEmail: string | null;
}

export type FloorPlanMode = "2d" | "3d";
export type FloorPlanView = "plan" | "list";
