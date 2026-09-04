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
}));
