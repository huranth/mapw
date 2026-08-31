import { create } from "zustand";
import { createBlockModel, type BlockModelState } from "@/terminals/blockModel";

export interface PaneRuntime { readonly paneId: string; alive: boolean; shell: string | null; cwd: string | null; hostname: string | null; exitCode: number | null; tuiRunning: boolean; blockModel: BlockModelState; }

interface TerminalState {
  panes: Record<string, PaneRuntime>;
  register: (paneId: string) => void;
  unregister: (paneId: string) => void;
  markSpawned: (paneId: string, shell: string, cwd: string) => void;
  markExited: (paneId: string, exitCode: number) => void;
  markTuiEntered: (paneId: string) => void;
  markTuiExited: (paneId: string) => void;
  setBlockModel: (paneId: string, mutator: (m: BlockModelState) => BlockModelState) => void;
  setCwd: (paneId: string, cwd: string, hostname: string) => void;
}

const upd = (s: TerminalState, paneId: string, patch: Partial<PaneRuntime>): Partial<TerminalState> => {
  const p = s.panes[paneId];
  return p ? { panes: { ...s.panes, [paneId]: { ...p, ...patch } } } : {};
};

export const useTerminalsStore = create<TerminalState>((set) => ({
  panes: {},
  register: (paneId) => set((s) => ({ panes: { ...s.panes, [paneId]: { paneId, alive: false, shell: null, cwd: null, hostname: null, exitCode: null, tuiRunning: false, blockModel: createBlockModel() } } })),
  unregister: (paneId) => set((s) => { if (!s.panes[paneId]) return s; const { [paneId]: _, ...rest } = s.panes; return { panes: rest }; }),
  markSpawned: (paneId, shell, cwd) => set((s) => upd(s, paneId, { alive: true, shell, cwd, exitCode: null, tuiRunning: false })),
  markExited: (paneId, exitCode) => set((s) => upd(s, paneId, { alive: false, exitCode, tuiRunning: false })),
  markTuiEntered: (paneId) => set((s) => (s.panes[paneId]?.tuiRunning ? s : upd(s, paneId, { tuiRunning: true }))),
  markTuiExited: (paneId) => set((s) => (s.panes[paneId] && !s.panes[paneId].tuiRunning ? s : upd(s, paneId, { tuiRunning: false }))),
  setBlockModel: (paneId, mutator) => set((s) => upd(s, paneId, { blockModel: mutator(s.panes[paneId]!.blockModel) })),
  setCwd: (paneId, cwd, hostname) => set((s) => upd(s, paneId, { cwd, hostname })),
}));
