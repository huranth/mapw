# mapw

Multi-pane terminal workspace — a calm desktop shell for running several terminals side by side on a paper-like canvas. Local-first, no account.

- `software/` — desktop app (Electron + React + xterm.js + ReactFlow). Dynamic 1–100 panes, count-aware sizing, tidy grid, minimap, paper theme. Install + docs: [software/README.md](software/README.md).
- `website/` — public site (Vite) — hero arrangement, live download + live stats from Supabase. Docs: [website/README.md](website/README.md).
- `supabase/` — edge functions (`device-heartbeat`, `live-stats`) + migrations. Secrets in `.env` are gitignored.
