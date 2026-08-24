import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  PtyEvent,
  PtySpawnOptions,
} from "@bridgespace/backend/renderer";
import type { Settings } from "@bridgespace/backend";
import type { Bridge } from "../src/bridge/types";

type PtyDataEvent = Extract<PtyEvent, { type: "data" }>;
type PtyExitEvent = Extract<PtyEvent, { type: "exit" }>;

// Thin shim: the preload exposes a tiny promise + disposer surface and routes
// to the main-process handlers; no renderer code lives here, so nothing is
// pulled into the preload bundle beyond type erasure.
const api: Bridge = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (partial: Partial<Settings>) =>
    ipcRenderer.invoke("settings:update", partial),
  // Native folder picker — drives "+ New terminal" + first-ever-launch gate.
  openDirectoryDialog: () => ipcRenderer.invoke("dialog:openDirectory"),
  // Detected-installed-CLI scan — fills the chip strip on each pane header.
  detectCliTools: () => ipcRenderer.invoke("cli:detect"),
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
