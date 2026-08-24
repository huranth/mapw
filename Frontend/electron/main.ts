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
import { fileURLToPath, URL } from "node:url";
import {
  PtyService,
  SettingsStore,
  CliToolDetector,
  type PtySpawnOptions,
  type Settings,
} from "@bridgespace/backend";
import { seedOpencodeTheme } from "./opencodeThemeSeeder";
import { seedCodexTheme } from "./codexThemeSeeder";

// Terminal color-scheme auto-detection hint for leaf TUIs. The COLORFGBG
// `fgIndex;bgIndex` convention — "0;15" declares fg=black, bg=white (bright
// ANSI palette slot) — nudges TUIs that consult it toward their light variant.
// Set early so every pane (spawned later via node-pty) and every CLI child
// process launched inside a pane inherits it. Best-effort only — the two CLIs
// we explicitly theme bypass it on Windows: opencode's termenv hardcodes the
// term bg to ANSIColor(0)=black and ignores COLORFGBG (its real light lock is
// `seedOpencodeTheme()`'s kv.json `theme_mode_lock`, awaited below), and codex
// reads the live console bg via GetConsoleScreenBufferInfoEx (its light lever
// is the pane-side console-color pin in shellIntegration.ts's `powerShellRc`,
// set when the pwsh pane boots).
process.env["COLORFGBG"] = "0;15";

// electron-vite emits ESM output (.mjs) under type=module; __dirname is not
// defined natively in ESM, so resolve the bundled-module directory from import.meta.url.
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

function getCliDetector(): CliToolDetector {
  if (!cliDetector) cliDetector = new CliToolDetector();
  return cliDetector;
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

  // Detected-installed-CLI scan. The user clicks "+ New terminal"; the pane
  // boots RAW (no auto-opencode); the chip strip on the pane header absorbs
  // the curated CLI list and renders only the chips for binaries the detector
  // actually resolved on PATH. Returning the memoized scan means the IPC is
  // effectively free after the first call — the singleton's cache makes every
  // subsequent renderer-side ensureLoaded trivial.
  ipcMain.handle("cli:detect", async () => {
    return getCliDetector().detect();
  });
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
    // Cluster 7a — win32 titlebar style. The previous ternary returned
    // `"default"` on win32, which SILENTLY deactivates the Window-Controls-
    // Overlay (`titleBarOverlay` only takes effect on a hidden/frameless
    // style). End result: the OS-native Win32 caption bar (~32px) stacked
    // ABOVE our React-rendered 44px `.titlebar` = double chrome; the CSS
    // `-webkit-app-region: drag` on `.titlebar` didn't take (drag regions
    // apply to frameless/hidden-titlebar windows only); and the painted
    // WCO buttons never displaced our `.titlebar__actions` cluster. win32
    // now opts into `"hidden"` so the WCO paints min/close/max INTO our
    // .titlebar — `styles.css` reserves right-padding for them via the
    // data-platform attribute stamped from main.tsx.
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
      // DevTools disabled at the webContents level. Opening DevTools (or any
      // accidental renderer reload it invites) destroys every running PTY
      // session living in the Backend main process — catastrophic mid-session.
      // Paired with Menu.setApplicationMenu(null) + the before-input-event
      // guard below so there's no user path back to a reload mid-session.
      // Intentional even during `electron-vite dev`: the only escape hatch is
      // re-enabling this + restarting the host window.
      devTools: false,
    },
  });

  // Intercept key combos BEFORE the renderer sees them — `event.preventDefault`
  // swallows the input before Chromium's default action. DevTools is disabled at
  // the webContents level (`devTools:false` above), AND the application menu is
  // stripped on win/linux (see Menu.setApplicationMenu branch below) so the
  // menu-bound DevTools + Reload accelerators have NO binding to keypress. The
  // branches below are belt-and-braces for stray menus re-added in the future,
  // PLUS the Chromium-level accelerators the menu removal doesn't reach
  // (Ctrl/Cmd+Shift+R force-reload, Alt+arrow history-nav). Plain Ctrl/Cmd+R is
  // intentionally NOT blocked: on Windows the shell's reverse-incremental-search
  // (bash/zsh) IS Ctrl+R, and xterm already swallows the key when a pane has
  // focus; with the menu gone a bare Ctrl+R can't reload the app anyway.
  win.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const isMac = process.platform === "darwin";
    const mod = input.control || input.meta;
    // Ctrl/Cmd+Shift+R (Chromium-level force-reload accelerator). Bare F5 is
    // NOT in this predicate — it's a real TUI keystroke (Midnight Commander's
    // "Copy file", htop's "Tree view", many more); swallowing it broke every
    // TUI that binds F5, AND F5 wasn't a Chromium-level reload accelerator in
    // our menu-null BrowserWindow either (the only load-bearing reload
    // accelerator was the menu `CmdOrCtrl+R` role, killed by
    // Menu.setApplicationMenu(null) on win/linux with no Chromium-level
    // fallback in these builds). Ctrl+Shift+R stays — Chromium DOES honor it
    // at the webContents level, menu removal doesn't reach it.
    if (mod && input.shift && key === "r") {
      event.preventDefault();
      return;
    }
    // Alt+Left / Alt+Right — Chromium binds these to web-history navigation
    // at the webContents level (independent of the menu). A stray
    // Alt-arrow during pane interaction could otherwise navigate the
    // renderer away, orphaning every PTY (React cleanups don't fire on
    // hard nav without a pagehide wiring; PTYs are reaped only at app-quit
    // by `before-quit → disposeAll`).
    if (input.alt && (key === "arrowleft" || key === "arrowright")) {
      event.preventDefault();
      return;
    }
    // DevTools openers — `(mod && shift && key === "i")` and (mac)
    // `(meta && alt && key === "i")` are the Chromium-level DevTools role
    // accelerators that survive a stripped menu; `devTools:false` already
    // makes the DevTools webview unavailable so this is belt-and-braces.
    // Bare F12 was previously blocked here as "a second route to an
    // accidental reload" — but F12 isn't a Chromium-level DevTools role
    // accelerator AND `devTools:false` already no-ops the webview; the
    // predicate swallowed F12 needlessly (some ncurses TUIs bind it) while
    // addressing a non-binding. Dropped.
    if (
      (mod && input.shift && key === "i") ||
      (isMac && input.meta && input.alt && key === "i")
    ) {
      event.preventDefault();
    }
  });

  // Navigation surface (Cluster 3). One origin is loaded (dev server or
  // app://index.html); every other renderer-initiated navigation — a
  // drag-drop file:// onto the canvas (the renderer-side HTML5 DnD guard in
  // main.tsx catches the common drop, but `will-navigate` is the backstop
  // for any Chromium-level fallback), an embedded `<webview>` attach, or a
  // stray history shortcut that slipped past the `before-input-event` and
  // `app-command` guards — would tear down React, orphan every PTY (no
  // ptyKill on hard nav), and leave the orphaned shells reaped only at app
  // quit. Deny them wholesale; we have no use case for renderer-side
  // navigation beyond the initial load.
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  win.webContents.on("will-redirect", (event) => {
    event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  // OS-level mouse history buttons — emitted as the BaseWindow-level
  // `app-command` event with "browser-backward" / "browser-forward"
  // payloads (mice with hardware back/forward buttons on win32/linux
  // trigger these). NOTE: in Electron this event lives on BaseWindow /
  // BrowserWindow (NOT webContents — `win.webContents.on("app-command")`
  // is a type error: the overload isn't on WebContents). Same orphan
  // navigation path as Alt+Left/Right; denying both end-states keeps the
  // pane-mounted renderer from going anywhere off the initial load.
  win.on("app-command", (_event, command) => {
    if (command === "browser-backward" || command === "browser-forward") {
      // app-command's event has no preventDefault() counterpart on the
      // window emitter (it's informational — Electron only acts on the
      // command via webContents navigation, which we've already denied
      // at the will-navigate / will-redirect gates above). This handler
      // is here as a defence-in-depth no-op so a future Electron build
      // that wires app-command -> webContents.goForward/goBack without a
      // will-navigate hook still can't drive the renderer off-page.
    }
  });

  // Window-open channel (Cluster 3 + closes C10 RCE-via-terminal-link).
  // xterm's WebLinksAddon default handler calls bare `window.open()` on
  // clicked URLs; with `nativeWindowOpen` absent (we deliberately don't set
  // it), Electron's default creates a child BrowserWindow inheriting this
  // preload → the child re-gets the full bridge IPC surface (ptySpawn,
  // settings:update, ...). Routing HTTP(S) URLs to `shell.openExternal`
  // opens them in the system browser AND denies any in-app child window,
  // cutting the bridge surface from external content entirely.
  win.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) {
      void shell.openExternal(details.url);
    }
    // Any other URL scheme (file://, mailto:, javascript:, ...): deny. We
    // never want a child window loadable from terminal-content links.
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
    // Pin codex's light SYNTAX theme into ~/.codex/config.toml (or
    // $CODEX_HOME). The chrome lever for codex on Windows is the pane-side
    // console-color pin in shellIntegration.ts (levers split across layers —
    // see codexThemeSeeder.ts header). Like seedOpencodeTheme, this is
    // best-effort: its own try/catch never throws, so the await can't hang boot.
    await seedCodexTheme();
    // Strip the default application menu (Cluster 7b). On win/linux the
    // default menu carries the "View → Reload / Force Reload / Toggle
    // Developer Tools" accelerators that are exactly the reload+DevTools
    // paths we're blocking (the `devTools:false` webContents opt + the
    // `before-input-event` guards above are belt-and-braces against stray
    // menu re-adds); `null` removes those accelerators at the source.
    //
    // On darwin the Edit-role accelerators (Cmd+C / Cmd+V / Cmd+X / Cmd+A /
    // Cmd+Z / Cmd+Shift+Z) are dispatched to the focused webContents
    // THROUGH the application menu's role items — removing the menu makes
    // those role objects nonexistent and Cmd+C/V/X/A silently no-op inside
    // the two text inputs (LayoutsScreen's save-current-canvas +
    // saved-row rename). Win/linux dispatch these natively so they don't
    // need the menu. Branch: darwin re-injects a minimal template carrying
    // the `appMenu` (also restores Cmd+Q quit semantics) + `editMenu` (auto-
    // populates copy/cut/paste/selectAll/undo/redo); win/linux keep `null`.
    // No `view`/`window` role entries on either branch → Reload / DoSend
    // Toggle-DevTools accelerators stay unbound → preserves the
    // `devTools:false` + before-input-event defense in depth.
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
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Best-effort cleanup before the process disappears — destroys every spawned
// PTY so the child shells don't outlive the host window.
app.on("before-quit", () => {
  if (ptys) ptys.disposeAll();
});

// Cluster 2d — Terminal Ctrl+C in `electron-vite dev` SIGKILLs the host
// before the renderer's `pagehide`/`beforeunload` runs (React cleanups don't
// fire on a hard quit), so `TerminalPane`'s `ptyKill` IPC never reaches main
// and ConPTY hosts for in-flight panes survive. The existing `before-quit`
// handler above already kills all PTYs, but `before-quit` only fires when
// `app.quit()` is invoked — a process-toplevel signal doesn't necessarily
// trip it before SIGKILL. Catching the streaming directly + reaping +
// `app.quit()` closes the dev-terminal-orphan window. SIGHUP/SIGTERM never
// fire on Windows but register silently and harmlessly on Linux/macOS (their
// default disposition is to terminate; our override rips first so the
// before-quit path runs first). Non-fatal all around.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
  process.on(sig, () => {
    try {
      if (ptys) ptys.disposeAll();
    } catch {
      // Best-effort — don't-ever-throw inside a signal handler on its way out.
    }
    app.quit();
  });
}
