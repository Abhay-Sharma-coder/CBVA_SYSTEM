import { create } from "zustand";

/**
 * Client-only UI state. Anything that lives on the server — bookings, seats,
 * the clock — belongs in TanStack Query, not here. Keeping that line sharp is
 * what stops the two stores drifting apart in Phase 3.
 */
interface UiState {
  /** Floor plan: the seat the user is hovering or has keyboard focus on. */
  focusedSeatCode: string | null;
  setFocusedSeatCode: (code: string | null) => void;

  /** Which slot the floor plan is showing. */
  activeSlot: "AM" | "PM";
  setActiveSlot: (slot: "AM" | "PM") => void;

  /** Demo controls panel, collapsed by default so it stays out of the way. */
  demoPanelOpen: boolean;
  toggleDemoPanel: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  focusedSeatCode: null,
  setFocusedSeatCode: (code) => set({ focusedSeatCode: code }),
  activeSlot: "AM",
  setActiveSlot: (slot) => set({ activeSlot: slot }),
  demoPanelOpen: false,
  toggleDemoPanel: () => set((s) => ({ demoPanelOpen: !s.demoPanelOpen })),
}));
