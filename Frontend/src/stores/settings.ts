import { create } from "zustand";
import { DEFAULT_SETTINGS, type Settings } from "@bridgespace/backend/renderer";

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  ensureLoaded: () => Promise<void>;
  reload: () => Promise<void>;
  update: (partial: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  ensureLoaded: async () => {
    if (get().loaded) return;
    await get().reload();
  },
  reload: async () => {
    const { settings } = await window.bridge.getSettings();
    set({ settings, loaded: true });
  },
  update: async (partial) => {
    const { settings } = await window.bridge.updateSettings(partial);
    set({ settings });
  },
}));
