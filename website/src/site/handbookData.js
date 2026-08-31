// Field Notes — mapw facts only.

export const RELEASE_FEED = "";

export const KEYS = [
  { k: "settings file", v: "%APPDATA%\\@bridgespace\\frontend\\settings.json" },
  { k: "mac / linux",   v: "~/Library/... and ~/.config/@bridgespace/frontend" },
  { k: "usage",         v: "localStorage mapw:usage" },
];

export const SECTIONS = [
  {
    id: "start",
    title: "Quick start",
    desc: "Run from source. No installer yet, no account. Pick a folder and you get four terminals on a canvas.",
    bullets: [
      "git clone, cd software, npm install, npm run dev (Node 20+ on Windows)",
      "First launch: welcome picker, choose one folder or per pane",
      "Returning: last workspace restored, delete settings.json to reset",
    ],
    code: [
      "git clone https://github.com/huranth/mapw.git",
      "cd mapw/software",
      "npm install",
      "npm run dev",
    ].join("\n"),
    note: "Shells: bash, zsh, sh, pwsh, PowerShell, cmd. ConPTY tuned for Windows.",
  },
  {
    id: "canvas",
    title: "Canvas & panes",
    desc: "Panes are free floating nodes. Position and size persist, buffer does not.",
    bullets: [
      "Drag header to move, edges and corners to resize",
      "Header shows pane id and live state: ready, exit 0, exit 1, EXIT",
      "New terminal picks a folder and drops a 5th pane at last.x+60",
    ],
    code: [
      "{",
      '  "workspace": {',
      '    "nodes": [',
      '      { "paneId": "p1", "cwd": "C:\\\\Users\\\\you\\\\project",',
      '        "position": { "x": 0, "y": 0 },',
      '        "size": { "width": 560, "height": 320 },',
      '        "cliId": "claude" }',
      "    ]",
      "  }",
      "}",
    ].join("\n"),
    note: "Persisted after 400 ms. See canvas.ts:10 and types.ts:11.",
  },
  {
    id: "layouts",
    title: "Layouts",
    desc: "One built in template. Save anything you arrange, applying creates fresh ids.",
    bullets: [
      "Built in: Split 2x2 raw (four shells, no CLI)",
      "Save current as usr-… layout in savedLayouts",
      "Apply creates fresh paneIds, cwd falls back to lastCwd, cliId pinned if installed",
    ],
    code: [
      "{",
      '  "savedLayouts": [{',
      '    "id": "usr-a1b2", "name": "Frontend + backend", "builtin": false,',
      '    "nodes": [ ]',
      "  }]",
      "}",
    ].join("\n"),
    note: "See layouts.ts:9. Summary example: 4 panes, claude and codex.",
  },
  {
    id: "shells",
    title: "Shell integration",
    desc: "Never edits your profile. Writes a throwaway rc in temp that sources your profile, then emits OSC marks.",
    bullets: [
      "Temp rc per pane (bash rcfile, zsh ZDOTDIR, pwsh File), cleaned up on exit",
      "Emits: 133;A prompt, 133;C output, 133;D exit, 7 cwd",
      "Drives: command blocks, exit badge, TUI detection",
    ],
    code: [
      "\\x1b]133;A\\x07  # prompt start",
      "\\x1b]133;C\\x07  # output start",
      "\\x1b]133;D;0\\x07 # command end exit 0",
      "\\x1b]7;file://host/C:/Users/you\\x07  # cwd",
    ].join("\n"),
    note: "Source: shellIntegration.ts:99, osc.ts:13, PtyService.ts:59.",
  },
  {
    id: "clis",
    title: "CLI chips",
    desc: "Scans your PATH and pins what it finds. Click a chip to type the launch command.",
    bullets: [
      "Curated: opencode, claude, aider, codex, gemini, amp",
      "Detection: walks PATH and PATHEXT on Windows, checks executable bit elsewhere",
      "Launch: writes binary plus return into the pane PTY",
    ],
    code: [
      "chips from PATH scan on launch",
      "pane header [opencode] [claude] click writes claude",
      "layout persists cliId per node",
    ].join("\n"),
    note: "No setup file. Chips also power the catalogue console.",
  },
  {
    id: "updates",
    title: "Updates",
    desc: "Portable exe that swaps itself. No background installer.",
    bullets: [
      "Every 30 min: GET releases/latest.json, if newer download to TEMP",
      "Staged: sidebar shows Update ready, applied on quit via PowerShell swap",
      "Dev builds never self update",
    ],
    code: [
      'GET https://…/releases/latest.json',
      "{",
      '  "version": "1.2.3",',
      '  "url": "…/releases/mapw-1.2.3.exe",',
      "}",
    ].join("\n"),
    note: "See updater.ts:78 and shared.js for SUPABASE_URL override.",
  },
  {
    id: "data",
    title: "Data",
    desc: "Local first. Counts leave. Contents do not.",
    bullets: [
      "On disk: settings.json, localStorage mapw:usage",
      "On wire counts only: installId, label hostname, platform, appVersion every 15 min",
      "Live counter is seen in last 20 min, no rows returned",
    ],
    code: [
      "local:",
      "  settings, workspace skeleton, saved layouts, usage",
      "",
      "sent counts only:",
      "  { installId, hostname, platform, appVersion }",
      "",
      "never stored:",
      "  command text, output, keystrokes, buffer",
    ].join("\n"),
    note: "Tables installs and devices have no RLS policies, only service role writes.",
  },
  {
    id: "reset",
    title: "Reset",
    desc: "When in doubt, delete one file and restart.",
    bullets: [
      "Reset welcome: delete %APPDATA%/@bridgespace/frontend/settings.json",
      "Clear usage: localStorage.removeItem mapw:usage in devtools",
      "Font and theme: only paper ships",
    ],
    code: [
      "Windows: %APPDATA%\\@bridgespace\\frontend\\settings.json",
      "macOS:   ~/Library/Application Support/@bridgespace/frontend/settings.json",
      "Linux:   ~/.config/@bridgespace/frontend/settings.json",
    ].join("\n"),
    note: "Heartbeat failures are silent and never block launch.",
  },
];
