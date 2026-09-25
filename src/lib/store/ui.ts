import { create } from "zustand";

import type { FloorPlanMode, FloorPlanView, SlotKey } from "@/components/floor-plan/types";
import type { ZoneCode } from "@/lib/floorplan";

/**
 * Client-only UI state. Anything that lives on the server — bookings, seats,
 * the clock — belongs in TanStack Query, not here. Keeping that line sharp is
 * what stops the two stores drifting apart in Phase 3.
 *
 * The 3D view reads this same store: which seat is focused, which is selected,
 * which date and slot, which zone. Only `viewport` is 2D-specific. Selecting a
 * seat in 3D and switching to 2D leaves the same seat selected, because there
 * is one value and not two.
 */
interface Viewport {
  /** Plan units per CSS pixel is 1/scale; scale 1 means 1 plan unit = 1 px. */
  scale: number;
  /** Translation in CSS pixels, applied after scaling. */
  x: number;
  y: number;
}

interface UiState {
  /** Floor plan: the seat the user is hovering or has keyboard focus on. */
  focusedSeatCode: string | null;
  setFocusedSeatCode: (code: string | null) => void;

  /** The seat whose booking dialog is open, if any. */
  selectedSeatCode: string | null;
  setSelectedSeatCode: (code: string | null) => void;

  /** Which slot the floor plan is showing. */
  activeSlot: SlotKey;
  setActiveSlot: (slot: SlotKey) => void;

  /** Which date the floor plan is showing, yyyy-MM-dd. Null until loaded. */
  activeDate: string | null;
  setActiveDate: (date: string) => void;

  /** Zone filter. Null means the whole floor. */
  activeZone: ZoneCode | null;
  setActiveZone: (zone: ZoneCode | null) => void;

  /** Plan or the accessible list. */
  view: FloorPlanView;
  setView: (view: FloorPlanView) => void;

  /**
   * 2D or 3D. Defaults to 2D everywhere, including on a phone that could show
   * 3D perfectly well: the plan is the keyboard-operable, print-legible one, so
   * 3D is something you choose rather than something you land in.
   */
  mode: FloorPlanMode;
  setMode: (mode: FloorPlanMode) => void;

  viewport: Viewport;
  setViewport: (v: Viewport) => void;

  /** Demo controls panel, collapsed by default so it stays out of the way. */
  demoPanelOpen: boolean;
  toggleDemoPanel: () => void;

  /**
   * Two independent label toggles (Phase 8 / A1), each answering a different
   * question and defaulting differently on purpose:
   *
   * - Occupancy labels (the bay chips + shading) are the Phase 7 LOD density
   *   read at whole-floor zoom. Default OFF — the plan starts quieter, and the
   *   non-text bay shading (`BayDensity`'s fill, always on) still answers "how
   *   full is the floor" without the numerals.
   * - Room labels are Phase 6 wayfinding for zones A and B, which have no
   *   bookable desks at all. Default ON — without them those wings read as
   *   broken rather than as a boardroom and a flexible room.
   *
   * Session-only, deliberately: in-memory Zustand state, not persisted to
   * localStorage or a database column. It survives zone changes and 2D/3D
   * switches within a visit and resets on reload — "per user" here means "for
   * as long as they are looking at the floor", not "forever on this device".
   */
  showOccupancyLabels: boolean;
  setShowOccupancyLabels: (v: boolean) => void;
  showRoomLabels: boolean;
  setShowRoomLabels: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  focusedSeatCode: null,
  setFocusedSeatCode: (code) => set({ focusedSeatCode: code }),
  selectedSeatCode: null,
  setSelectedSeatCode: (code) => set({ selectedSeatCode: code }),
  activeSlot: "AM",
  setActiveSlot: (slot) => set({ activeSlot: slot }),
  activeDate: null,
  setActiveDate: (date) => set({ activeDate: date }),
  activeZone: null,
  setActiveZone: (zone) => set({ activeZone: zone }),
  view: "plan",
  setView: (view) => set({ view }),
  mode: "2d",
  setMode: (mode) => set({ mode }),
  viewport: { scale: 1, x: 0, y: 0 },
  setViewport: (viewport) => set({ viewport }),
  demoPanelOpen: false,
  toggleDemoPanel: () => set((s) => ({ demoPanelOpen: !s.demoPanelOpen })),

  showOccupancyLabels: false,
  setShowOccupancyLabels: (v) => set({ showOccupancyLabels: v }),
  showRoomLabels: true,
  setShowRoomLabels: (v) => set({ showRoomLabels: v }),
}));
