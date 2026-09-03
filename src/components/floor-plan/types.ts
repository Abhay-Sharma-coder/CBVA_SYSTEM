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
  /** Occupant name, or the allocated name on a fixed desk. Null when free. */
  occupantName: string | null;
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

export type SlotKey = "AM" | "PM";

export interface SlotDefinition {
  key: SlotKey;
  label: string;
  start: string;
  end: string;
}

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
