# mapw

> *"Four terminals, one sheet of paper, zero agents."*

Most "accelerate your dev workflow" desktop apps this year ship with Fifty Things (tm): an LLM, a Kanban, a file browser, a "command palette", a sidebar of integrations, a tooltipdex, a side-hustle — and then they collapse under their own weight before the user installs three of them. `mapw` is the opposite. You get a sheet of paper, four terminals, and a place to drop folders. You pick a folder, you type a command, you watch the exit code, you close it. The chrome is one accent colour, two greys, and a hairline; the iconography is just inline SVG. There is no celebratory confetti when an op succeeds and there is no "your day in code" recap. People who genuinely need a Kanban inside their terminal emulator already sold out to Notion once this year; they can have theirs.

## installation

There is no `.exe` yet — you run it from source. You need Node 20+ on a Windows machine (the ConPTY spawn + resize paths are tuned to Windows shells; Linux/macOS build in theory but no one's tried).

```bash
git clone https://github.com/huranth/mapw.git
cd mapw/software
npm install        # postinstalls electron + esbuild — firewalls stall here
npm run dev        # electron-vite dev: spawns the window + HMR
```

The first `npm install` triggers `electron` and `esbuild` postinstalls. A corporate firewall or sandbox can stall on those; if the window fails to launch complaining about an entry point in the electron vite main config, recover with `npm rebuild electron esbuild --foreground-scripts` and run `npm run dev` again.

## commands

| Command              | What it does                                                              |
|----------------------|---------------------------------------------------------------------------|
| `npm install`        | One install for both workspaces + the `electron` / `esbuild` postinstalls.|
| `npm test`           | Vitest across `Backend/tests` + `Frontend/tests` — no workspace flags.   |
| `npm run typecheck`  | `tsc --noEmit` for both workspaces (strict + `noUncheckedIndexedAccess`). |
| `npm run dev`        | `electron-vite dev` — launches the app with HMR.                          |
| `npm run build`      | `electron-vite build` — bundles main + preload + renderer to `Frontend/out`. |

## developing

The repo is npm workspaces — `Frontend/` (Electron + Vite + React renderer, plus `electron/` for the main-process code) and `Backend/` (a stripped-down, headless Node package holding the settings store + OSC parser + the shared types; the renderer imports only types from it via a browser-safe subpath so Vite doesn't choke on `node:fs`).

Settings persist to `%APPDATA%\@bridgespace\frontend\settings.json` on Windows (`~/Library/Application Support/@bridgespace/frontend/settings.json` on macOS, `~/.config/@bridgespace/frontend/settings.json` on Linux). Delete that file to reset the welcome flow; otherwise launches show a Returning screen with Continue / Choose a new folder CTAs.

The single shipped theme is `paper` (light, near-white sheet, near-black ink, blue accent). Don't add more.
