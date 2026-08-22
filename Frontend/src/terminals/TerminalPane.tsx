// One xterm.js canvas bound to one Backend PTY, mounted as the leaf of a
// React Flow node (see TerminalNode.tsx). The mount effect is keyed on
// `paneId`: spawn the PTY, open the Terminal in the host div, load
// FitAddon + WebLinksAddon + Unicode11Addon (WebGL disabled — see
// USE_WEBGL), register OSC 133/7 handlers that cut the block model as
// markers stream in, wire `term.onData` → window.bridge.ptyWrite, subscribe
// onPtyData/onPtyExit, refit on container resize. The PTY is killed on
// unmount so the child shell cannot outlive its node body; React Flow
// unmounting the node fires that cleanup for free.

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { parseOscPayload } from "@bridgespace/backend/renderer";
import { useSettingsStore } from "@/stores/settings";
import { useTheme } from "@/themes";
import { useTerminalsStore } from "@/stores/terminals";
import { toXtermTheme } from "./toXtermTheme";
import { createBlockModel, disposeBlockModel, handleOscEvent } from "./blockModel";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";

const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;
// Fallback font stack appended to the user's preference; mirrors the root
// --bs-font-mono assembly in App.tsx so the canvas renders the same family as
// every other monospace technical value in the UI.
const MONO_FALLBACK =
  ', ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
// Resize-settle debounce. React Flow + ResizeObserver fire live-resize events
// every animation frame during a node drag, so a debounce below ~150ms would
// flush fit()+ptyResize mid-drag → xterm re-render + ConPTY SIGWINCH-loop →
// flicker. 200ms coalesces the gesture into one commit.
const RESIZE_DEBOUNCE_MS = 200;
// WebGL renderer disabled. Faster write throughput on long scrollbacks, but
// its glyph atlas is re-rasterised on every terminal.resize() so continuous
// drag-resizes tear the canvas visibly. The built-in canvas renderer trades
// throughput for stable resizes; flip back on only after the resize chain is
// throttled harder.
const USE_WEBGL = false;

export interface TerminalPaneProps {
  readonly paneId: string;
  /** Per-pane cwd override (from canvas node data). Takes priority over
   *  Settings.lastCwd. Set by the "+ New terminal" folder picker; null on
   *  the 4 boot seeds (whose canvas node data is {}). */
  readonly cwd?: string | null;
}

export function TerminalPane({ paneId, cwd }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fontFamily = useSettingsStore((s) => s.settings.fontFamily);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const scrollbackLines = useSettingsStore((s) => s.settings.scrollbackLines);
  // Settings.lastCwd is the app-wide launch default — set by Workspace's
  // first-ever-launch picker AND updated by every subsequent "+ New
  // terminal" pick. Used here as the per-pane cwd fallback when canvas
  // node data has no explicit cwd (the 4 boot seeds).
  const lastCwd = useSettingsStore((s) => s.settings.lastCwd);

  const { theme } = useTheme();

  const register = useTerminalsStore((s) => s.register);
  const unregister = useTerminalsStore((s) => s.unregister);
  const markSpawned = useTerminalsStore((s) => s.markSpawned);
  const markExited = useTerminalsStore((s) => s.markExited);
  const setBlockModel = useTerminalsStore((s) => s.setBlockModel);
  const setCwd = useTerminalsStore((s) => s.setCwd);
  const pane = useTerminalsStore((s) => s.panes[paneId]);

  // All instance-scoped refs kept stable so the mount effect can run once per
  // paneId. The Terminal + FitAddon live on refs because their lifetime is the
  // pane's lifetime, not React render state.
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const aliveRef = useRef(false);
  // Set true once the spawn IPC settles and the main process has registered a
  // session for this pane. Guards the first ResizeObserver fire (which lands
  // ~80ms after mount) from dispatching ptyResize before PtyService.spawn has
  // reached `sessions.set`.
  const spawnedRef = useRef(false);
  // Last (cols, rows) delivered to ptyResize; lets us skip no-op resizes —
  // ConPTY forwards even identical-dim resizes to the child as a WM_SIZE,
  // triggering a needless redraw in the running TUI.
  const lastResizeRef = useRef<{ cols: number; rows: number } | null>(null);

  // Lifecycle effect — keyed on paneId, runs once on mount, tears down
  // (terminal disposed, PTY killed, listeners lifted) on unmount. Idempotent
  // across StrictMode's dev double-mount: each spawn discards a fresh rc and
  // each cleanup disposes before the next mount respawns.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      fontFamily: `${fontFamily}${MONO_FALLBACK}`,
      fontSize,
      scrollback: scrollbackLines,
      // TUIs (Bubble Tea / opencode) emit raw \n in their streaming diff
      // frames meaning "down 1 row, stay at same column" (a soft wrap), not
      // "next row at col 1". xterm's default `convertEol:true` translates \n
      // → \r\n and advances to col 1, so the next chunk lands on the wrong
      // column and later CUP writes leave stale prefixes in the shifted row.
      // PowerShell always emits \r\n so it renders identically either way.
      convertEol: false,
      macOptionIsMeta: true,
      theme: toXtermTheme(theme.tokens),
      allowProposedApi: true,
      // `cursorBlink: true` so the cursor animates a visible blink whenever
      // the pane has focus. Without it the cursor is a static block and reads
      // as "the terminal is frozen / I can't tell if it's alive" — which was
      // the M2 "no blinker" complaint.
      cursorBlink: true,
    });
    terminal.open(host);
    termRef.current = terminal;
    aliveRef.current = true;
    registerTerminal(paneId, terminal);

    const fit = new FitAddon();
    fitRef.current = fit;
    terminal.loadAddon(fit);

    if (USE_WEBGL) {
      try {
        // WebGL unavailable (headless / no GL) → xterm falls back to its
        // canvas renderer automatically; swallow and move on.
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        terminal.loadAddon(webgl);
      } catch {
        // no-op
      }
    }

    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new Unicode11Addon());
    // The Unicode11Addon registers version "11" via `term.unicode.register`;
    // we then opt into it as the active grapheme clusterer.
    terminal.unicode.activeVersion = "11";

    // Cut blocks from the live OSC 133 / OSC 7 stream. xterm's parser
    // delivers the payload AFTER the leading code+`;`, so we rebuild the
    // full `parseOscPayload`-shaped string ("133;A", "7;file://…") before
    // parsing. Markers are pinned so the block-gutter overlay can later
    // resolve screen-row positions.
    // Auto-launch the TUI: send `opencode\r` on the FIRST promptStart of
    // each mount cycle. The ptySpawn resolve fires on session registration,
    // not on a live prompt — the rc-installed prompt override emits `]133;A`
    // only at the latter edge, so promptStart is the clean "ready for input"
    // signal. A local sentinel resets on remount so a re-spawned pane
    // re-launches; later promptStarts belong to the running TUI and skip.
    let firstPrompt = false;
    const onOsc133 = (data: string): boolean => {
      const event = parseOscPayload(`133;${data}`);
      if (event) {
        const prompt =
          event.type === "promptStart" ? terminal.registerMarker(0) : null;
        const exit =
          event.type === "commandEnd" ? terminal.registerMarker(0) : null;
        setBlockModel(paneId, (m) => handleOscEvent(m, event, { prompt, exit }));
        if (event.type === "promptStart" && !firstPrompt) {
          firstPrompt = true;
          void window.bridge.ptyWrite(paneId, "opencode\r");
        }
      }
      return true; // consume so xterm doesn't fall through to other handlers
    };
    const onOsc7 = (data: string): boolean => {
      const event = parseOscPayload(`7;${data}`);
      if (event && event.type === "cwd") {
        setCwd(paneId, event.path, event.hostname);
        setBlockModel(paneId, (m) => handleOscEvent(m, event));
      }
      return true;
    };
    terminal.parser.registerOscHandler(133, onOsc133);
    terminal.parser.registerOscHandler(7, onOsc7);

    // User keystrokes → PTY stdin.
    const disposeOnData = terminal.onData((data) => {
      void window.bridge.ptyWrite(paneId, data);
    });

    // PTY stdout → xterm canvas. The bridge fans every pane's stream through a
    // single shared channel, so filter to THIS pane's events here.
    const disposePtyData = window.bridge.onPtyData((evt) => {
      if (evt.paneId !== paneId) return;
      terminal.write(evt.data);
    });
    const disposePtyExit = window.bridge.onPtyExit((evt) => {
      if (evt.paneId !== paneId) return;
      markExited(paneId, evt.exitCode);
    });

    // Fit on container resize, then notify the PTY of the new geometry.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // Skip the resize IPC entirely until the spawn has landed and the
        // main session is registered — otherwise we error "no session for
        // pane" during the brief mount-to-spawn window.
        if (!aliveRef.current || !spawnedRef.current || !fitRef.current || !termRef.current) return;
        try {
          fitRef.current.fit();
        } catch {
          // xterm throws on fit against a detached/zero-size container; skip.
        }
        const t = termRef.current;
        if (!t) return;
        const last = lastResizeRef.current;
        if (last && last.cols === t.cols && last.rows === t.rows) return;
        lastResizeRef.current = { cols: t.cols, rows: t.rows };
        void window.bridge.ptyResize(paneId, t.cols, t.rows);
      }, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(host);

    register(paneId);
    const term = terminal;

    // Measure the host's on-screen geometry BEFORE spawning so the shell +
    // TUI launch at the right size from the first render. The previous flow
    // spawned at 80x24 and only fit() afterward, which on ConPTY cascaded a
    // silent size-change into the running TUI and corrupted the next overlay
    // render. Falling back to INITIAL gives the ResizeObserver a chance to
    // catch up if the host isn't laid out yet (fit() throws on zero size).
    let spawnCols = INITIAL_COLS;
    let spawnRows = INITIAL_ROWS;
    try {
      fit.fit();
      if (term.cols > 0 && term.rows > 0) {
        spawnCols = term.cols;
        spawnRows = term.rows;
      }
    } catch {
      // container unsized at mount; ResizeObserver will fit shortly after
      // and the standard resize IPC then plays through.
    }

    // Per-pane cwd (from the canvas node) takes priority, then
    // Settings.lastCwd (welcome-flow primary folder), then null → PtyService
    // falls back to os.homedir(). The Workspace gate ensures settings are
    // loaded before this mount runs so lastCwd is never stale.
    const resolvedCwd = cwd ?? lastCwd ?? null;
    void window.bridge
      .ptySpawn({
        paneId,
        cols: spawnCols,
        rows: spawnRows,
        cwdOverride: resolvedCwd,
      })
      .then((res) => {
        if (!aliveRef.current || termRef.current !== term) return;
        markSpawned(paneId, res.shell, res.cwd);
        spawnedRef.current = true;
        try {
          fit.fit();
        } catch {
          // container not yet sized; the ResizeObserver will retry shortly.
        }
        // Only ptyResize if the post-spawn fit changed dims relative to what
        // we spawned with. The old comparison against INITIAL_COLS/ROWS fired a
        // resize on every pane whose initial fit differed from 80x24, even
        // ones we'd pre-fit — the size-cascade bell we're eliminating here.
        if (term.cols !== spawnCols || term.rows !== spawnRows) {
          void window.bridge.ptyResize(paneId, term.cols, term.rows);
        }
        // Record the dims the PTY now has so the ResizeObserver's first fire
        // (and every subsequent identical-fit fire) skips the redundant resize
        // IPC that would otherwise trip a needless TUI redraw.
        lastResizeRef.current = { cols: term.cols, rows: term.rows };
        term.focus();
      })
      .catch((err: unknown) => {
        // A failed spawn (e.g. shell missing) keeps the pane alive but
        // unspawned; surface the error inline so the user sees it.
        if (aliveRef.current) {
          terminal.writeln(
            `\x1b[31m[mapw] pty spawn failed: ${(err as Error).message}\x1b[0m`,
          );
        }
      });

    return () => {
      aliveRef.current = false;
      spawnedRef.current = false;
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      disposeOnData.dispose();
      disposePtyData();
      disposePtyExit();
      void window.bridge.ptyKill(paneId);
      // Dispose every marker the block model still pins so they don't outlive
      // the terminal that owns them.
      setBlockModel(paneId, (m) => {
        disposeBlockModel(m);
        return m;
      });
      try {
        terminal.dispose();
      } catch {
        // already disposed during StrictMode's earlier cycle; ignore
      }
      termRef.current = null;
      fitRef.current = null;
      unregisterTerminal(paneId);
      unregister(paneId);
    };
    // The lifecycle is owned by paneId; settings/theme are reconciled in their
    // own effects below so this one stays pane-mount-scoped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  // Re-apply theme tokens on every theme change (recolors all panes at once).
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = toXtermTheme(theme.tokens);
  }, [theme]);

  // Re-apply font + refit on every font change.
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontFamily = `${fontFamily}${MONO_FALLBACK}`;
    termRef.current.options.fontSize = fontSize;
    try {
      fitRef.current?.fit();
    } catch {
      // ignore fit races during teardown
    }
  }, [fontFamily, fontSize]);

  const blocks = pane?.blockModel.blocks ?? [];
  const lastClosed = [...blocks].reverse().find((b) => b.status === "closed");
  const chipState = !pane?.alive
    ? "dead"
    : lastClosed
      ? lastClosed.exitCode === 0
        ? "ok"
        : "err"
      : "ready";
  const chipText = !pane?.alive
    ? `EXIT ${pane?.exitCode ?? 0}`
    : lastClosed
      ? `→ ${lastClosed.exitCode ?? "?"}`
      : "ready";

  return (
    <div
      className="pane"
      data-testid={`pane-${paneId}`}
      data-pane-id={paneId}
      data-state={chipState}
    >
      <div className="pane__host" ref={hostRef} />
      <span className="pane__chip" data-state={chipState} aria-hidden="true">
        {chipText}
      </span>
    </div>
  );
}
