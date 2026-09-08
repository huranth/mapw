import { createRoot } from "react-dom/client";
import { App } from "@/App";
import "@/styles.css";

import "@xterm/xterm/css/xterm.css";

import "@xyflow/react/dist/style.css";

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

createRoot(root).render(<App />);