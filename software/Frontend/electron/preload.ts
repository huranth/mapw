import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  PtyEvent,
  PtySpawnOptions,
} from "@bridgespace/backend/renderer";
import type { Settings, UpdateProgress } from "@bridgespace/backend";
import type { Bridge } from "../src/bridge/types";

type PtyDataEvent = Extract<PtyEvent, { type: "data" }>;
type PtyExitEvent = Extract<PtyEvent, { type: "exit" }>;

const api: Bridge = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (partial: Partial<Settings>) =>
    ipcRenderer.invoke("settings:update", partial),

  openDirectoryDialog: () => ipcRenderer.invoke("dialog:openDirectory"),

  detectCliTools: () => ipcRenderer.invoke("cli:detect"),
  whoami: () => ipcRenderer.invoke("system:whoami"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  onUpdateStatus: (listener: (status: UpdateProgress) => void) => {
    const wrapped = (_event: unknown, status: UpdateProgress): void => listener(status);
    ipcRenderer.on("update:status", wrapped);
    return (): void => {
      ipcRenderer.removeListener("update:status", wrapped);
    };
  },
  ptySpawn: (opts: PtySpawnOptions) => ipcRenderer.invoke("pty:spawn", opts),
  ptyWrite: (paneId: string, data: string) =>
    ipcRenderer.invoke("pty:write", paneId, data),
  ptyResize: (paneId: string, cols: number, rows: number) =>
    ipcRenderer.invoke("pty:resize", paneId, cols, rows),
  ptyKill: (paneId: string) => ipcRenderer.invoke("pty:kill", paneId),
  onPtyData: (listener) => {
    const handler = (_event: IpcRendererEvent, evt: PtyDataEvent) => listener(evt);
    ipcRenderer.on("pty:data", handler);
    return () => {
      ipcRenderer.off("pty:data", handler);
    };
  },
  onPtyExit: (listener) => {
    const handler = (_event: IpcRendererEvent, evt: PtyExitEvent) => listener(evt);
    ipcRenderer.on("pty:exit", handler);
    return () => {
      ipcRenderer.off("pty:exit", handler);
    };
  },
};

contextBridge.exposeInMainWorld("bridge", api);
