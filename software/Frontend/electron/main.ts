import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
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
} from "@mapw/backend";
import { seedOpencodeTheme } from "./opencodeThemeSeeder";
import { seedCodexTheme } from "./codexThemeSeeder";
import { isSelfUpdatePossible, runUpdateCycle } from "./updater";

function supabaseOrigin(): string {
  // Vite inlines import.meta.env at build time; main process falls back to process.env at runtime.
  // Hardcode prod as last resort so heartbeat/update never silently disables if env is missing
  // (the URL is public by design; anon key remains client-safe via RLS).
  const fromMeta = (import.meta as unknown as { env?: Record<string, unknown> }).env?.VITE_SUPABASE_URL;
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim().replace(/\/+$/, "");
  const fromEnv = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim().replace(/\/+$/, "");
  return "https://pdynfowdtiulrllqetbl.supabase.co";
}
const HEARTBEAT_URL = (() => {
  const o = supabaseOrigin();
  return o ? `${o}/functions/v1/device-heartbeat` : "";
})();
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

function anonymizedLabel(hostname: string, installId: string): string {
  return createHash("sha256").update(`${installId}:${hostname}`).digest("hex").slice(0, 16);
}

process.env["COLORFGBG"] = "0;15";

// Explicit AppUserModelID — ties window/taskbar/shortcut to the same identity
// as electron-builder's appId (com.mapw.app). Without this, Windows may group
// the taskbar icon under a generic Electron ID and show the stale Atom icon
// even when the exe's baked icon is correct.
if (process.platform === "win32") {
  try { app.setAppUserModelId("com.mapw.app"); } catch {}
}

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
async function sendHeartbeat(offline = false): Promise<void> {
  if (!HEARTBEAT_URL) return;
  const installId = getStore().getAll().installId;
  if (!installId) return;
  const payload = JSON.stringify({
    installId,
    label: anonymizedLabel(os.hostname(), installId),
    platform: process.platform,
    appVersion: app.getVersion(),
    ...(offline ? { offline: true } : {}),
  });
  // Retry with exponential backoff + jitter for transient network failures.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(HEARTBEAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`heartbeat ${res.status}`);
      return;
    } catch (err) {
      if (attempt === 2) {
        console.debug("[heartbeat] failed after 3 attempts:", err);
        return;
      }
      const backoff = 500 * Math.pow(2, attempt) + Math.random() * 300;
      await new Promise((r) => setTimeout(r, backoff));
    }
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
    try {
      const s = getStore();
      await s.ensureLoaded();
      return { settings: s.getAll() };
    } catch (err) {
      console.error("[ipc] settings:get failed:", err);
      throw err;
    }
  });

  ipcMain.handle(
    "settings:update",
    async (_event: IpcMainInvokeEvent, partial: Partial<Settings>) => {
      try {
        const s = getStore();
        const settings = await s.update(partial);
        return { settings };
      } catch (err) {
        console.error("[ipc] settings:update failed:", err);
        throw err;
      }
    },
  );

  ipcMain.handle(
    "dialog:openDirectory",
    async (event: IpcMainInvokeEvent) => {
      try {
        const parent = BrowserWindow.fromWebContents(event.sender);
        if (parent) {
          return await dialog.showOpenDialog(parent, {
            title: "Pick working directory",
            properties: ["openDirectory", "createDirectory", "promptToCreate"],
          });
        }
        return await dialog.showOpenDialog({
          title: "Pick working directory",
          properties: ["openDirectory", "createDirectory", "promptToCreate"],
        });
      } catch (err) {
        console.error("[ipc] dialog:openDirectory failed:", err);
        return { canceled: true, filePaths: [] as string[] };
      }
    },
  );

  ipcMain.handle(
    "pty:spawn",
    async (_event: IpcMainInvokeEvent, opts: PtySpawnOptions) => {
      try {
        return await getPtys().spawn(opts);
      } catch (err) {
        console.error("[ipc] pty:spawn failed:", err);
        throw err;
      }
    },
  );
  ipcMain.handle(
    "pty:write",
    async (_event: IpcMainInvokeEvent, paneId: string, data: string) => {
      try {
        return await getPtys().write(paneId, data);
      } catch (err) {
        console.error("[ipc] pty:write failed:", err);
        throw err;
      }
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
      try {
        return await getPtys().resize(paneId, cols, rows);
      } catch (err) {
        console.error("[ipc] pty:resize failed:", err);
        throw err;
      }
    },
  );
  ipcMain.handle(
    "pty:kill",
    async (_event: IpcMainInvokeEvent, paneId: string) => {
      try {
        return await getPtys().kill(paneId);
      } catch (err) {
        console.error("[ipc] pty:kill failed:", err);
        // kill is idempotent — don't throw
        return;
      }
    },
  );

  ipcMain.handle("cli:detect", async () => {
    try {
      return await getCliDetector().detect();
    } catch (err) {
      console.error("[ipc] cli:detect failed:", err);
      return { tools: [] };
    }
  });

  ipcMain.handle("system:whoami", async () => {
    try {
      return os.userInfo().username;
    } catch {
      return "";
    }
  });

  ipcMain.handle("update:check", async () => {
    try {
      void checkForUpdates();
    } catch (err) {
      console.error("[ipc] update:check failed:", err);
    }
  });
}

function resolveWindowIcon(): Electron.NativeImage | undefined {
  if (process.platform !== "win32") return undefined;
  // Use the same source the installer uses (build/icon.ico) — kept in
  // extraResources as icon.ico/icon.png so the window/taskbar and the
  // exe/shortcut (win.icon + nsis.installerIcon) stay in sync.
  // In dev, thisDir is .../electron (source) or .../out/main (built). Try both one- and two-level ups to cover both.
  const devCandidates = [
    join(thisDir, "..", "build", "icon.ico"),
    join(thisDir, "..", "build", "icon.png"),
    join(thisDir, "..", "..", "build", "icon.ico"),
    join(thisDir, "..", "..", "build", "icon.png"),
    join(process.cwd(), "build", "icon.ico"),
    join(process.cwd(), "build", "icon.png"),
    join(process.cwd(), "Frontend", "build", "icon.ico"),
    join(process.cwd(), "Frontend", "build", "icon.png"),
    join(process.cwd(), "software", "Frontend", "build", "icon.ico"),
    join(process.cwd(), "software", "Frontend", "build", "icon.png"),
  ];
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.ico"), join(process.resourcesPath, "icon.png")]
    : devCandidates;
  for (const candidate of candidates) {
    try {
      const img = nativeImage.createFromPath(candidate);
      if (!img.isEmpty()) {
        // Ensure we return a sized image for the window/taskbar — Windows prefers 256 for high-DPI.
        // If the ICO contains multiple sizes, nativeImage will pick the best; we just verify it's not empty.
        return img;
      }
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function createWindow(): void {
  const win = new BrowserWindow({
    icon: resolveWindowIcon(),
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

    if (key === "f12") { event.preventDefault(); return; }
    if (mod && input.shift && (key === "i" || key === "j" || key === "c")) { event.preventDefault(); return; }
    if (isMac && input.meta && input.alt && key === "i") { event.preventDefault(); return; }

    if (mod && input.shift && key === "r") {
      event.preventDefault();
      return;
    }

    if (input.alt && (key === "arrowleft" || key === "arrowright")) {
      event.preventDefault();
      return;
    }
  });
  if (app.isPackaged) {
    win.webContents.on("devtools-opened", () => win.webContents.closeDevTools());
  }

  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  win.webContents.on("will-redirect", (event) => {
    event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  // Block any permission prompts (camera, mic, etc.) — mapw doesn't need them
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  // Only allow external https to trusted hosts
  win.webContents.setWindowOpenHandler((details) => {
    try {
      const u = new URL(details.url);
      if (u.protocol !== "https:") return { action: "deny" };
      const host = u.hostname.toLowerCase();
      const ok = host === "github.com" || host.endsWith(".github.com") || host.endsWith(".supabase.co") || host.endsWith(".vercel.app") || host === "fonts.googleapis.com" || host === "fonts.gstatic.com";
      if (!ok) return { action: "deny" };
      void shell.openExternal(details.url);
    } catch {}
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
    // Jitter heartbeat to avoid thundering herd for 1000s (30s ±2.5s)
    const heartbeatTimer = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS + Math.random() * 5000);
    void checkForUpdates();
    const updateTimer = setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS + Math.random() * 5000);
    // Keep reference so we can await it in before-quit
    let offlineBeacon: Promise<void> | null = null;
    const sendOfflineBeacon = async (): Promise<void> => {
      if (!HEARTBEAT_URL) return;
      const installId = getStore().getAll().installId;
      if (!installId) return;
      try {
        // Use keepalive + no-cache to ensure it lands even as the process exits.
        // Fall back to a tiny timeout so quit isn't blocked more than 800ms.
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 800);
        await fetch(HEARTBEAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ installId, offline: true }),
          keepalive: true,
          cache: "no-store",
          signal: ctrl.signal,
        } as RequestInit).catch(() => {});
        clearTimeout(t);
      } catch {}
    };
    app.on("will-quit", (e: Electron.Event) => {
      clearInterval(heartbeatTimer);
      clearInterval(updateTimer);
      // Block quit just long enough for the offline beacon to land — makes "live" drop in ~2s
      // instead of waiting for the 75s window. Keep it under 900ms so quit still feels instant.
      if (!offlineBeacon) {
        e.preventDefault();
        offlineBeacon = sendOfflineBeacon().finally(() => {
          if (applyUpdateOnQuit) applyUpdateOnQuit();
          // Quit for real after beacon (or timeout)
          setTimeout(() => app.exit(0), 50);
        });
        // Safety: if beacon hangs, force quit after 900ms
        setTimeout(() => { if (offlineBeacon) app.exit(0); }, 900);
      }
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
