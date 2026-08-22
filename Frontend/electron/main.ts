import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  PtyService,
  SettingsStore,
  type PtySpawnOptions,
  type Settings,
} from "@bridgespace/backend";
import { seedOpencodeTheme } from "./opencodeThemeSeeder";

// Terminal color-scheme auto-detection hint for opencode's TuiTheme.mode()
// selector: the COLORFGBG standard `fgIndex;bgIndex` convention — "0;15"
// declares fg=black, bg=white (bright ANSI palette slot) — which nudges most
// leaf TUIs (opencode's `paper` theme included) toward their light variant.
// Set as early as possible so every PowerShell pane spawned later (via
// node-pty) and every opencode child process invoked inside the pane inherits
// this env. The opencode-ai maintainer convention isn't documented, so this
// is best-effort — if opencode ignores COLORFGBG and falls back to dark, the
// fallback path is an OSC 11 autofeed responder in TerminalPane.tsx.
process.env["COLORFGBG"] = "0;15";

// electron-vite emits ESM output (.mjs) under type=module; __dirname is not
// defined natively in ESM, so resolve the bundled-module directory from import.meta.url.
const thisDir = fileURLToPath(new URL(".", import.meta.url));

let store: SettingsStore | null = null;
let ptys: PtyService | null = null;

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
    // The FIRST event channel in the codebase: stream ptyData / ptyExit
    // events out to every open BrowserWindow via webContents.send. The
    // renderer subscribes through bridge.onPtyData / onPtyExit and
    // disposes when its TerminalPane unmounts.
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

  // Native OS folder picker. Drives "+ New terminal" (always prompts) and the
  // Workspace first-ever-launch gate (prompts once when settings.lastCwd is
  // null on boot). `dialog.showOpenDialog`'s two overloads: with a parent
  // BrowserWindow the dialog attaches modal to that window; without it falls
  // back to a windowless picker — but the overload signature requires the
  // parent to be `BaseWindow` (NOT `BaseWindow | undefined`), so we branch on
  // whether `BrowserWindow.fromWebContents` actually resolved one. The
  // options object is inlined into each branch so TS's contextual typing
  // narrows the string literals in `properties` to Electron's literal union
  // — a hoisted local would widen them to `string[]` and break the assign.
  // `openDirectory` constrains to one folder. `createDirectory` +
  // `promptToCreate` let the user type a new path (mirrors VS Code's
  // "Open Folder"). Returns Electron's standard
  // `{ canceled: boolean; filePaths: string[] }` shape.
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
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    // Paper-light canvas — match the native window border + loading flash
    // to our light panel surface (#FAFAFA / --bs-bg) so the pre-React-load
    // square doesn't punch a white/dark contrast square into the chrome.
    backgroundColor: "#FAFAFA",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    titleBarOverlay:
      process.platform === "win32"
        ? { color: "#FAFAFA", height: 36, symbolColor: "#171717" }
        : undefined,
    webPreferences: {
      preload: join(thisDir, "..", "preload", "index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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
  // Await the opencode TUI preference seed BEFORE registerIpc +
  // createWindow so any opencode launched by a pane (the TerminalPane
  // auto-launch fires after React mounts — many seconds later) reads
  // `theme=paper` from `~/.config/opencode/tui.json` instead of opencode's
  // built-in default. The seed writes tui.json directly (idempotent, atomic).
  // opencode 1.18 auto-migrates a legacy top-level `theme` field from
  // opencode.jsonc into tui.json on first launch, so bypassing the jsonc
  // write avoids re-triggering that migration every boot. The seed's own
  // try/catch never throws, so the await can't hang boot. See
  // opencodeThemeSeeder.ts for the retry + failure semantics.
  .then(async () => {
    await seedOpencodeTheme();
    registerIpc();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Best-effort cleanup before the process disappears — destroys every spawned
// PTY so the child shells don't outlive the host window.
app.on("before-quit", () => {
  if (ptys) ptys.disposeAll();
});
