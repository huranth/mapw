import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { join } from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import {
  PtyService,
  SettingsStore,
  CliToolDetector,
  type PtySpawnOptions,
  type Settings,
  type UpdateProgress,
} from "@bridgespace/backend";
import { seedOpencodeTheme } from "./opencodeThemeSeeder";
import { seedCodexTheme } from "./codexThemeSeeder";
import { isSelfUpdatePossible, runUpdateCycle } from "./updater";

function supabaseOrigin(): string {
  const fromEnv = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim().replace(/\/+$/, "");
  return "";
}
const HEARTBEAT_URL = (() => {
  const o = supabaseOrigin();
  return o ? `${o}/functions/v1/device-heartbeat` : "";
})();
const HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

function anonymizedLabel(hostname: string, installId: string): string {
  return createHash("sha256").update(`${installId}:${hostname}`).digest("hex").slice(0, 16);
}

process.env["COLORFGBG"] = "0;15";

const thisDir = fileURLToPath(new URL(".", import.meta.url));

let store: SettingsStore | null = null;
let ptys: PtyService | null = null;
let cliDetector: CliToolDetector | null = null;

function getStore(): SettingsStore {
  if (!store) {
    const path = join(app.getPath("userData"), "settings.json");
    store = new SettingsStore({ path });
  }
  return store;
}

function getPtys(): PtyService {
  if (!ptys) {
    ptys = new PtyService();

    ptys.onData((event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("pty:data", event);
      }
    });
    ptys.onExit((event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send("pty:exit", event);
      }
    });
  }
  return ptys;
}

function getCliDetector(): CliToolDetector {
  if (!cliDetector) cliDetector = new CliToolDetector();
  return cliDetector;
}

function broadcastUpdateStatus(status: UpdateProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("update:status", status);
  }
}

let applyUpdateOnQuit: (() => void) | null = null;
let updateCycleRunning = false;

async function checkForUpdates(): Promise<void> {
  if (updateCycleRunning || !isSelfUpdatePossible()) return;
  updateCycleRunning = true;
  try {
    await runUpdateCycle({
      isPackaged: app.isPackaged,
      currentVersion: app.getVersion(),
      onStatus: broadcastUpdateStatus,
      onStaged: (apply) => {
        applyUpdateOnQuit = apply;
      },
    });
  } finally {
    updateCycleRunning = false;
  }
}

/** Anonymous install heartbeat — powers the website's live counter. */
async function sendHeartbeat(): Promise<void> {
  try {
    if (!HEARTBEAT_URL) return;
    const installId = getStore().getAll().installId;
    if (!installId) return;
    await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installId,
        label: anonymizedLabel(os.hostname(), installId),
        platform: process.platform,
        appVersion: app.getVersion(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Telemetry must never break the app; connectivity is optional.
  }
}

async function ensureInstallId(): Promise<string> {
  const s = getStore();
  await s.ensureLoaded();
  const existing = s.getAll().installId;
  if (existing) return existing;
  const installId = randomUUID();
  await s.update({ installId });
  return installId;
}

function registerIpc(): void {
  ipcMain.handle("settings:get", async () => {
    const s = getStore();
    await s.ensureLoaded();
    return { settings: s.getAll() };
  });

  ipcMain.handle(
    "settings:update",
    async (_event: IpcMainInvokeEvent, partial: Partial<Settings>) => {
      const s = getStore();
      const settings = await s.update(partial);
      return { settings };
    },
  );

  ipcMain.handle(
    "dialog:openDirectory",
    async (event: IpcMainInvokeEvent) => {
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (parent) {
        return dialog.showOpenDialog(parent, {
          title: "Pick working directory",
          properties: ["openDirectory", "createDirectory", "promptToCreate"],
        });
      }
      return dialog.showOpenDialog({
        title: "Pick working directory",
        properties: ["openDirectory", "createDirectory", "promptToCreate"],
      });
    },
  );

  ipcMain.handle(
    "pty:spawn",
    async (_event: IpcMainInvokeEvent, opts: PtySpawnOptions) => {
      return getPtys().spawn(opts);
    },
  );
  ipcMain.handle(
    "pty:write",
    async (_event: IpcMainInvokeEvent, paneId: string, data: string) => {
      return getPtys().write(paneId, data);
    },
  );
  ipcMain.handle(
    "pty:resize",
    async (
      _event: IpcMainInvokeEvent,
      paneId: string,
      cols: number,
      rows: number,
    ) => {
      return getPtys().resize(paneId, cols, rows);
    },
  );
  ipcMain.handle(
    "pty:kill",
    async (_event: IpcMainInvokeEvent, paneId: string) => {
      return getPtys().kill(paneId);
    },
  );

  ipcMain.handle("cli:detect", async () => {
    return getCliDetector().detect();
  });

  ipcMain.handle("system:whoami", async () => {
    try {
      return os.userInfo().username;
    } catch {
      return "";
    }
  });

  ipcMain.handle("update:check", async () => {
    void checkForUpdates();
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,

    backgroundColor: "#FAFAFA",

    titleBarStyle:
      process.platform === "darwin"
        ? "hiddenInset"
        : process.platform === "win32"
          ? "hidden"
          : "default",
    titleBarOverlay:
      process.platform === "win32"
        ? { color: "#FAFAFA", height: 36, symbolColor: "#171717" }
        : undefined,
    webPreferences: {
      preload: join(thisDir, "..", "preload", "index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,

      devTools: false,
    },
  });

  win.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const isMac = process.platform === "darwin";
    const mod = input.control || input.meta;

    if (mod && input.shift && key === "r") {
      event.preventDefault();
      return;
    }

    if (input.alt && (key === "arrowleft" || key === "arrowright")) {
      event.preventDefault();
      return;
    }

    if (
      (mod && input.shift && key === "i") ||
      (isMac && input.meta && input.alt && key === "i")
    ) {
      event.preventDefault();
    }
  });

  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  win.webContents.on("will-redirect", (event) => {
    event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  win.on("app-command", (_event, command) => {
    if (command === "browser-backward" || command === "browser-forward") {

    }
  });

  win.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(thisDir, "..", "renderer", "index.html"));
  }
}

void app
  .whenReady()

  .then(async () => {
    await seedOpencodeTheme();

    await seedCodexTheme();

    if (process.platform === "darwin") {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }]),
      );
    } else {
      Menu.setApplicationMenu(null);
    }
    registerIpc();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    await ensureInstallId();
    void sendHeartbeat();
    const heartbeatTimer = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    void checkForUpdates();
    const updateTimer = setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
    app.on("will-quit", () => {
      clearInterval(heartbeatTimer);
      clearInterval(updateTimer);
      if (applyUpdateOnQuit) applyUpdateOnQuit();
    });
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (ptys) ptys.disposeAll();
});

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
  process.on(sig, () => {
    try {
      if (ptys) ptys.disposeAll();
    } catch {

    }
    app.quit();
  });
}
