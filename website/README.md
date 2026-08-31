# mapw website

Landing + download portal for mapw — **"the drafting table"**, mapw's own
visual identity: warm drafting paper with a faint dot grid, ink typography,
the app's forest teal, Fraunces display serif for headlines, JetBrains Mono
for labels and terminals.

## Signature pieces (all original, built for mapw)

- **The Arrangement** (`src/scene/arrangement.js`) — the hero: four floating
  terminal panes on a canvas, because that's literally the product. Plain
  WebGL three.js, ink outlines, slow drift, buttery cursor tilt (lerped, never
  drops), per-pane hover lift with teal edges.
- **The canvas footer** (`src/site/paneGrid.js`) — outlined Fraunces wordmark
  over a grid of pane cells that illuminate under the cursor with a decaying
  heat trail, like panes being placed on the canvas.
- **The chip console** (`src/site/chipsConsole.js`) — a live terminal that
  types `mapw launch <chip>` and streams the real curated CLI list
  (from `software/Backend/src/cli/types.ts`); filter, keyboard scan,
  click-to-copy launch commands.

## Real-data wiring

- **Download button** reads the same `releases/latest.json` the desktop app's
  auto-updater reads; honest "coming soon" until the first release exists.
- **Live counter** (hero endpoint strip) polls the `live-stats` edge function;
  hidden until the server answers — the site never shows fake numbers.

## Develop / build / deploy

```bash
cd website
npm install
npm run dev      # vite dev server
npm run build    # outputs dist/
```

Deploy to Vercel: import the repo, set **Root Directory = `website`**, framework
preset **Vite** (auto-detected), zero env vars. Output is static — `dist/`.
Entry points (`index.html`, `handbook.html`) are declared in `vite.config.js`.

## Publishing an app release

1. Bump `software/Frontend/package.json` `version`.
2. `cd software && npm run dist` → `Frontend/release/mapw.exe`.
3. `SUPABASE_SERVICE_ROLE=<key> node software/scripts/publish-release.mjs --notes "…"`

The site's download button picks it up on the next visit; running installs
update themselves within 30 minutes.
