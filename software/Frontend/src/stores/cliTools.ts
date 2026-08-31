import { create } from "zustand";
import type { DetectedCliTool } from "@bridgespace/backend/renderer";

interface CliToolsState { cliTools: DetectedCliTool[]; loaded: boolean; ensureLoaded: () => Promise<void>; reload: () => Promise<void>; }

let pending: Promise<void> | null = null;

export const useCliToolsStore = create<CliToolsState>((set, get) => ({
  cliTools: [],
  loaded: false,
  ensureLoaded: async () => {
    if (get().loaded) return;
    if (pending) return pending;
    pending = get().reload().finally(() => { pending = null; });
    return pending;
  },
  reload: async () => {
    try { const { tools } = await window.bridge.detectCliTools(); set({ cliTools: tools, loaded: true }); }
    catch { set({ cliTools: [], loaded: true }); }
  },
}));
