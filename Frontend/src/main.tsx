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

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found in index.html");

// StrictMode stays OFF here on purpose: the dev mount→cleanup→remount cycle
// dispatches ptySpawn/ptyKill/ptySpawn per pane whose arrival order at the
// Electron main side races PtyService's `sessions.set(...)`. Re-enable only
// after we add a spawn-completion gate to the kill path so cleanup can't race
// an in-flight spawn.
createRoot(root).render(<App />);
