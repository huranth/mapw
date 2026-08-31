import type { Settings, UpdateProgress } from "@bridgespace/backend";
import type { DetectCliToolsResult, PtyEvent, PtySpawnOptions, PtySpawnResponse } from "@bridgespace/backend/renderer";

export interface GetSettingsResponse { settings: Settings; }
export type PtyDataListener = (event: Extract<PtyEvent, { type: "data" }>) => void;
export type PtyExitListener = (event: Extract<PtyEvent, { type: "exit" }>) => void;

export interface Bridge {
  getSettings: () => Promise<GetSettingsResponse>;
  updateSettings: (partial: Partial<Settings>) => Promise<GetSettingsResponse>;
  openDirectoryDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  detectCliTools: () => Promise<DetectCliToolsResult>;
  whoami: () => Promise<string>;
  checkForUpdates: () => Promise<void>;
  onUpdateStatus: (listener: (status: UpdateProgress) => void) => () => void;
  ptySpawn: (opts: PtySpawnOptions) => Promise<PtySpawnResponse>;
  ptyWrite: (paneId: string, data: string) => Promise<void>;
  ptyResize: (paneId: string, cols: number, rows: number) => Promise<void>;
  ptyKill: (paneId: string) => Promise<void>;
  onPtyData: (listener: PtyDataListener) => () => void;
  onPtyExit: (listener: PtyExitListener) => () => void;
}

declare global { interface Window { bridge: Bridge; } }
