import { create } from "zustand";
import type { BlockModelState } from "@/terminals/blockModel";

// Per-pane runtime state. The store mirrors just enough to drive the
// StatusBar + SideRail meta + future block-meta decorations; the xterm
// canvas + heavy data path stay inside TerminalPane (the store is not in
// the streaming hot path).

export interface PaneRuntime {
  readonly paneId: string;
  alive: boolean;
  shell: string | null;
  cwd: string | null;
  hostname: string | null;
  exitCode: number | null;
  blockModel: BlockModelState;
}

interface TerminalState {
  panes: Record<string, PaneRuntime>;
  // -- actions --
  register: (paneId: string) => void;
  unregister: (paneId: string) => void;
  markSpawned: (paneId: string, shell: string, cwd: string) => void;
  markExited: (paneId: string, exitCode: number) => void;
  setBlockModel: (
    paneId: string,
    mutator: (m: BlockModelState) => BlockModelState,
  ) => void;
  setCwd: (paneId: string, cwd: string, hostname: string) => void;
}

function emptyBlockModel(): BlockModelState {
  return { blocks: [], current: null, cwd: null, hostname: null };
}

export const useTerminalsStore = create<TerminalState>((set) => ({
  panes: {},
  register: (paneId) =>
    set((s) => {
      if (s.panes[paneId]) return s;
      const pane: PaneRuntime = {
        paneId,
        alive: false,
        shell: null,
        cwd: null,
        hostname: null,
        exitCode: null,
        blockModel: emptyBlockModel(),
      };
      return { panes: { ...s.panes, [paneId]: pane } };
    }),
  unregister: (paneId) =>
    set((s) => {
      if (!s.panes[paneId]) return s;
      const rest = { ...s.panes };
      delete rest[paneId];
      return { panes: rest };
    }),
  markSpawned: (paneId, shell, cwd) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      return {
        panes: { ...s.panes, [paneId]: { ...pane, alive: true, shell, cwd } },
      };
    }),
  markExited: (paneId, exitCode) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      return {
        panes: {
          ...s.panes,
          [paneId]: { ...pane, alive: false, exitCode },
        },
      };
    }),
  setBlockModel: (paneId, mutator) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      return {
        panes: {
          ...s.panes,
          [paneId]: { ...pane, blockModel: mutator(pane.blockModel) },
        },
      };
    }),
  setCwd: (paneId, cwd, hostname) =>
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      return {
        panes: { ...s.panes, [paneId]: { ...pane, cwd, hostname } },
      };
    }),
}));
