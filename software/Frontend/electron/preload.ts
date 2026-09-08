import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  PtyEvent,
  PtySpawnOptions,
} from "@mapw/backend/renderer";
import type { Settings, UpdateProgress } from "@mapw/backend";
import type { Bridge } from "../src/bridge/types";

type PtyDataEvent = Extract<PtyEvent, { type: "data" }>;
type PtyExitEvent = Extract<PtyEvent, { type: "exit" }>;

function withTimeout<T>(p: Promise<T>, ms = 10_000): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error("ipc timeout")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t)) as Promise<T>;
}

const api: Bridge = {
  getSettings: () => withTimeout(ipcRenderer.invoke("settings:get")),
  updateSettings: (partial: Partial<Settings>) =>
    withTimeout(ipcRenderer.invoke("settings:update", partial)),

  openDirectoryDialog: () => withTimeout(ipcRenderer.invoke("dialog:openDirectory"), 30_000),

  detectCliTools: () => withTimeout(ipcRenderer.invoke("cli:detect"), 15_000),
  whoami: () => withTimeout(ipcRenderer.invoke("system:whoami"), 5_000),
  checkForUpdates: () => withTimeout(ipcRenderer.invoke("update:check"), 5_000),
  onUpdateStatus: (listener: (status: UpdateProgress) => void) => {
    const wrapped = (_event: unknown, status: UpdateProgress): void => listener(status);
    ipcRenderer.on("update:status", wrapped);
    return (): void => {
      ipcRenderer.removeListener("update:status", wrapped);
    };
  },
  ptySpawn: (opts: PtySpawnOptions) => withTimeout(ipcRenderer.invoke("pty:spawn", opts), 15_000),
  ptyWrite: (paneId: string, data: string) =>
    withTimeout(ipcRenderer.invoke("pty:write", paneId, data), 5_000),
  ptyResize: (paneId: string, cols: number, rows: number) =>
    withTimeout(ipcRenderer.invoke("pty:resize", paneId, cols, rows), 5_000),
  ptyKill: (paneId: string) => withTimeout(ipcRenderer.invoke("pty:kill", paneId), 5_000),
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
