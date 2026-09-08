# mapw

> *"One to a hundred terminals, one sheet of paper, zero agents."*

Most "accelerate your dev workflow" desktop apps this year ship with Fifty Things (tm): an LLM, a Kanban, a file browser, a "command palette", a sidebar of integrations, a tooltipdex, a side-hustle — and then they collapse under their own weight before the user installs three of them. `mapw` is the opposite. You get a sheet of paper, a few terminals, and a place to drop folders. You pick a folder, you type a command, you watch the exit code, you close it. The chrome is one accent colour, two greys, and a hairline; the iconography is just inline SVG. There is no celebratory confetti when an op succeeds and there is no "your day in code" recap.

## what it is now

- **Panes:** 1–100 on a ReactFlow canvas. Count-aware defaults (`1:520×300` down to `100:260×155`), `Tidy` grid, `MiniMap` beyond 12, virtualized beyond 25. Drag/resize with `NodeResizer` (min `320×160`), positions and sizes persist to `settings.json`. `fitView` is idle-gated so it never hijacks a drag.
- **Terminal:** `node-pty` (ConPTY) + `xterm.js` + `addon-webgl`/`fit`/`web-links`/`unicode11`. Shell integration injects OSC 133/7 for command blocks and cwd, no user rc required. PTY env is allowlisted, `shellOverride` is safe-pathed.
- **Usage:** paper-matched `z-insights` — `Total/Peak/Longest/Current/Longest` stats bar, `Activity` heatmap (224 days, daily/weekly/cumulative, no `__proto__` leak), `Daily time trend` (time/commands/panes, Last 7/30), `Activity breakdown` donut. All local (`localStorage` + `settings.json`), `device-heartbeat` is hashed and optional. Computing gate on first open.
- **Theme:** single `paper` (light, `#FBF8F5` sheet, `#1C1917` ink, `#E8E2D6` hairline). `Fraunces` for the Usage heading, `JetBrains Mono` for terminals.

## installation

You need Node 20+ on Windows (ConPTY tuned for `pwsh`/`powershell`/`cmd`/`bash`/`zsh`; Linux/macOS builds in theory).

```bash
git clone https://github.com/huranth/mapw.git
cd mapw/software
npm install        # postinstalls electron + esbuild — firewalls stall here
npm run dev        # electron-vite dev: spawns the window + HMR
npm run dist       # electron-builder → Frontend/release/mapw.exe (portable, unsigned)
```

First `npm install` triggers `electron`/`esbuild` postinstalls. If the window fails complaining about an entry point in the vite main config, run `npm rebuild electron esbuild --foreground-scripts` and `npm run dev` again.

## commands

| Command              | What it does                                                              |
|----------------------|---------------------------------------------------------------------------|
| `npm install`        | One install for both workspaces + the `electron` / `esbuild` postinstalls.|
| `npm test`           | Vitest across `Backend/tests` + `Frontend/tests` — no workspace flags.   |
| `npm run typecheck`  | `tsc --noEmit` for both workspaces (strict + `noUncheckedIndexedAccess`). |
| `npm run dev`        | `electron-vite dev` — launches the app with HMR.                          |
| `npm run build`      | `electron-vite build` — bundles main + preload + renderer to `Frontend/out`. |
| `npm run dist`       | `electron-builder --win portable` — `Frontend/release/mapw.exe`.         |

## developing

Repo is npm workspaces — `Frontend/` (Electron + Vite + React renderer, plus `electron/` for main) and `Backend/` (headless Node: `SettingsStore` + `PtyService` + `OscParser` + shared types via `backend/renderer` subpath so Vite doesn't choke on `node:fs`).

Settings persist to `%APPDATA%\@mapw\frontend\settings.json` on Windows (`~/Library/Application Support/@mapw/frontend/settings.json` on macOS, `~/.config/@mapw/frontend/settings.json` on Linux). Delete that file to reset the welcome flow; otherwise you get Returning → Continue / Choose new folder.

Security: `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `PtyService` env allowlist, `shellIntegration` safe-path, `SettingsStore` prototype-pollution filter.
