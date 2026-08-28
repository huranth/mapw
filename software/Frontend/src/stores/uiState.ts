// Cross-component UI state — currently just the Layouts panel open/close
// + the titlebar-visible phase mirror. TitleBar (mounted in App.tsx outside
// Workspace's phase machine) needs to know whether to render the Layouts
// button (only useful when a canvas exists, so gated on `activePhase ===
// "ready"`) and needs to open the panel. Workspace owns the phase machine but
// reads `layoutsPanelOpen` to swap the LayoutsScreen panel into the
// workspace cell — this small zustand store is the bridge between them.

import { create } from "zustand";

// Phase mirrors the type Workspace already uses for its local useState.
// TitleBar's Layouts button stays hidden unless `activePhase === "ready"`;
// Workspace's phase-mirror effect (see Workspace.tsx) keeps this in sync via
// `useUiState.getState().setActivePhase(p)` on each phase change. Never set
// to "layouts" — the panel is gated on `layoutsPanelOpen` instead (the phase
// machine stays 4-valued for cleanly mapping phase → workspace content).
export type Phase = "loading" | "welcome" | "returning" | "ready";

interface UiState {
  /** Whether the Layouts panel is open (rendered over the workspace cell by
   *  Workspace when true). TitleBar's Layouts button toggles this; Workspace
   *  subscribes + renders LayoutsScreen when true. The panel itself closes via
   *  closeLayouts (the X button or the apply handler). */
  layoutsPanelOpen: boolean;
  /** Mirror of Workspace's local `phase` state, kept in sync by Workspace's
   *  effect wiring. TitleBar reads this to gate Layouts button visibility —
   *  only useful when a canvas exists, so `activePhase === "ready"` shows the
   *  button. */
  activePhase: Phase;
  setLayoutsPanelOpen: (open: boolean) => void;
  openLayouts: () => void;
  closeLayouts: () => void;
  toggleLayouts: () => void;
  setActivePhase: (phase: Phase) => void;
}

export const useUiState = create<UiState>((set) => ({
  layoutsPanelOpen: false,
  activePhase: "loading",
  setLayoutsPanelOpen: (open) => set({ layoutsPanelOpen: open }),
  openLayouts: () => set({ layoutsPanelOpen: true }),
  closeLayouts: () => set({ layoutsPanelOpen: false }),
  toggleLayouts: () =>
    set((s) => ({ layoutsPanelOpen: !s.layoutsPanelOpen })),
  setActivePhase: (phase) => set({ activePhase: phase }),
}));
