// Cached renderer-side view of the curated CLI scan result from main. Drives
// the per-pane chip strip on TerminalNode's header — only detected-curated
// CLIs render as chips, so a fresh machine with one installed CLI shows a
// one-element strip instead of a row of dead chips that 404 on click.
//
// Modeled on stores/settings.ts ensureLoaded/reload. Best-effort: a misbe-
// having IPC scan falls through to `{ tools: [] }` + latched `loaded: true`
// so a broken scan never blocks the workspace flow or triggers retry storms
// — the user reopens the window to re-scan.

import { create } from "zustand";
import type { DetectedCliTool } from "@bridgespace/backend/renderer";

interface CliToolsState {
  cliTools: DetectedCliTool[];
  loaded: boolean;
  ensureLoaded: () => Promise<void>;
  reload: () => Promise<void>;
}

export const useCliToolsStore = create<CliToolsState>((set, get) => ({
  cliTools: [],
  loaded: false,
  ensureLoaded: async () => {
    if (get().loaded) return;
    await get().reload();
  },
  reload: async () => {
    try {
      const { tools } = await window.bridge.detectCliTools();
      set({ cliTools: tools, loaded: true });
    } catch {
      // A misbehaving scan (IPC thrown, detector error) shouldn't block the
      // workspace or hide the strip forever — empty curated list + latched
      // `loaded` so repeated ensureLoaded calls don't ping the IPC in a
      // loop. The user can close-and-reopen the window to re-scan.
      set({ cliTools: [], loaded: true });
    }
  },
}));
