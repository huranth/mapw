import { create } from "zustand";

export type Phase = "loading" | "welcome" | "returning" | "ready";
export type ActiveView = "workspace" | "insights";

interface UiState {
  layoutsPanelOpen: boolean;
  activePhase: Phase;
  activeView: ActiveView;
  hasEnteredWorkspace: boolean;
  openLayouts: () => void;
  closeLayouts: () => void;
  setActivePhase: (phase: Phase) => void;
  setActiveView: (view: ActiveView) => void;
  markEnteredWorkspace: () => void;
}

export const useUiState = create<UiState>((set) => ({
  layoutsPanelOpen: false,
  activePhase: "loading",
  activeView: "workspace",
  hasEnteredWorkspace: false,
  openLayouts: () => set({ layoutsPanelOpen: true }),
  closeLayouts: () => set({ layoutsPanelOpen: false }),
  setActivePhase: (phase) => set({ activePhase: phase }),
  setActiveView: (view) => set({ activeView: view }),
  markEnteredWorkspace: () => set({ hasEnteredWorkspace: true }),
}));
