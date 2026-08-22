import type { Settings } from "@bridgespace/backend";
import type {
  PtyEvent,
  PtySpawnOptions,
  PtySpawnResponse,
} from "@bridgespace/backend/renderer";

export interface GetSettingsResponse {
  settings: Settings;
}

/** Disposer-returning event subscribers. The renderer keeps a closure ref to
 *  the disposer and invokes it on cleanup; `ipcRenderer.off` is wired there. */
export type PtyDataListener = (event: Extract<PtyEvent, { type: "data" }>) => void;
export type PtyExitListener = (event: Extract<PtyEvent, { type: "exit" }>) => void;

export interface Bridge {
  // Settings.
  getSettings: () => Promise<GetSettingsResponse>;
  updateSettings: (partial: Partial<Settings>) => Promise<GetSettingsResponse>;
  // Native folder picker — "+ New terminal" + first-ever-launch Workspace gate.
  openDirectoryDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  // PTY — invoke pairs (request/response).
  ptySpawn: (opts: PtySpawnOptions) => Promise<PtySpawnResponse>;
  ptyWrite: (paneId: string, data: string) => Promise<void>;
  ptyResize: (paneId: string, cols: number, rows: number) => Promise<void>;
  ptyKill: (paneId: string) => Promise<void>;
  // PTY — streaming event subscriptions; disposer is invoked on cleanup.
  onPtyData: (listener: PtyDataListener) => () => void;
  onPtyExit: (listener: PtyExitListener) => () => void;
}

declare global {
  interface Window {
    bridge: Bridge;
  }
}
