import { createRoot } from "react-dom/client";
import { App } from "@/App";
import "@/styles.css";
// xterm's own stylesheet — the canvas layout (scrollbar, screen, helper
// textarea) lives here; without it the panes render unstyled.
import "@xterm/xterm/css/xterm.css";
// React Flow's base stylesheet — node / viewport / zoom chrome for the
// terminal canvas (see TerminalCanvas.tsx). Our styles.css overrides punch
// through the bits that clash with the paper vocabulary (node shadows, the
// dot-grid tint) but leave the layout plumbing intact.
import "@xyflow/react/dist/style.css";

// Cluster 7 — stamp the platform family on <html> so platform-specific CSS
// (the .titlebar WCO right-padding on win32 / traffic-light left-padding on
// darwin) can target via the [data-platform] selector. navigator.userAgent is
// set by Chromium per-OS so no async IPC bridge call is needed for a coarse
// darwin/win32/linux classifier. Done before render so first-paint CSS
// matches the platform — avoiding a one-frame flash where the titlebar
// resizes (or covers) the WCO buttons after detection.
if (typeof document !== "undefined") {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMac = /Mac(?:intosh|CPU|OS X)/i.test(ua);
  const isWin = /Windows/i.test(ua);
  document.documentElement.dataset.platform = isMac
    ? "darwin"
    : isWin
      ? "win32"
      : "linux";
}

// Cluster 3 — renderer-side native drag-drop guard. Dragging a file/folder
// onto the window makes Chromium attempt a `file://` navigation at the
// webContents level (the main-process `will-navigate`/`will-redirect`/`will-
// attach-webview` guards below deny every non-base URL as a backstop, but the
// renderer-side preventDefault on `dragover`/`drop` is the first-defense
// intercept — it swallows the raw drop BEFORE the webContents ever fires the
// navigate event). React Flow uses Pointer Events, NOT HTML5 DnD, and zero
// tree consumers care about native `drop` events, so the global preventDefault
// is safe — no functionality lost, and a stray file drop no longer tears down
// React (which would orphan every PTY session: React cleanups don't fire on
// hard navigation without a pagehide wiring; shells only reaped by app-quit's
// `disposeAll`).
if (typeof window !== "undefined") {
  for (const ev of ["dragover", "drop"] as const) {
    window.addEventListener(ev, (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    });
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found in index.html");

// StrictMode stays OFF here on purpose: the dev mount→cleanup→remount cycle
// dispatches ptySpawn/ptyKill/ptySpawn per pane whose arrival order at the
// Electron main side races PtyService's `sessions.set(...)`. Re-enable only
// after we add a spawn-completion gate to the kill path so cleanup can't race
// an in-flight spawn.
createRoot(root).render(<App />);
