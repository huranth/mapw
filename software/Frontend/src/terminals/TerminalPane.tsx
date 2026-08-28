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
import { useCliToolsStore } from "@/stores/cliTools";
import { useTheme } from "@/themes";
import { useTerminalsStore } from "@/stores/terminals";
import { toXtermTheme } from "./toXtermTheme";
import { applyTuiCursorStep, batchSyncFrames, detectTuiAltExit, detectTuiEnter, flushSyncBatcher, stripCursorVisibilityModes, SYNC_CLOSE, SYNC_FLUSH_TIMEOUT_MS, SYNC_OPEN, type SyncBatcher, type TuiCursorState } from "./syncBatcher";
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
  /** Optional curated-CLI id bound to this pane by a saved layout. When
   *  non-null AND the CLI is installed at apply time, TerminalPane auto-fires
   *  `${launchCommand}\r` once after ptySpawn resolves — the same primitive
   *  the chip-strip click in TerminalNode uses, so layout-launched and chip-
   *  launched CLIs share the identical `ptyWrite(paneId, ...)` path. Firing
   *  is one-shot per mount (via `autoLaunchedRef`); if the CLI isn't
   *  installed, the pane stays raw shell + writes a one-line yellow warning.
   *  null (and undefined — the boot-default case) means the pane boots raw
   *  shell and the chip strip remains the runtime CLI-choice surface. The
   *  cursor-strip + TUI latch machinery is NOT touched by this — identical
   *  to a chip-launched pane. */
  readonly cliId?: string | null;
}

export function TerminalPane({ paneId, cwd, cliId }: TerminalPaneProps) {
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
  const markTuiEntered = useTerminalsStore((s) => s.markTuiEntered);
  const markTuiExited = useTerminalsStore((s) => s.markTuiExited);
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
  // TUI ("full-screen app owns the pane") latch, advanced per PTY chunk by the
  // pure `applyTuiCursorStep` state machine (see syncBatcher.ts). The latch
  // flips ON on a takeover signal — EITHER the alt-screen enter
  // (`ESC [ ? 1049 h`, the opencode/claude/Bubble-Tea default) OR the Mode-2026
  // synced-output opener (`ESC [ ? 2026 h`) that codex emits (it renders
  // INLINE — never enters alt screen — so the old `?1049h`-only latch MISSED
  // codex entirely, leaving the chip strip visible + the cursor blinker
  // un-tempered during codex's working phase). It flips OFF on the matching
  // alt-screen leave (`?1049l`) OR on the bare shell's prompt resuming — the
  // OSC 133 `commandEnd`/`promptStart` pwsh's `function prompt` emits the
  // first time it runs after the inline TUI's process exits (handled in
  // onOsc133 below, set robustly via xterm's own parser so escapes split
  // across onData chunks can't miss). The latch drives two edge-fired side
  // effects in this watcher:
  //   * the chip-strip auto-hide (markTuiEntered/Exited below — the user can't
  //     fire `${cli}\r` into a running TUI's stdin while it's hidden);
  //   * the cursor-visibility STRIP gate (see `stripCursorVisibilityModes`
  //     below — the ACTUAL no-blink lever; codex's per-frame `?25h`/`?25l`
  //     toggles get stripped from the PTY stream while this latch is running
//     so `coreService.isCursorHidden` stays `false` → xterm paints a steady
//     inverse block at each flush, no per-frame strobe). `cursorBlink` stays
//     `true` (constructor default; no rising-edge flip — see (3) in the
//     watcher below for the live A/B verdict that retired the previous
//     false-flip). The focused pane's CSS
//     `@keyframes blink_block_* 1s step-end infinite` is attached, but DOM
//     churn from codex's per-frame render rebuilds the cursor cell each
//     frame, restarting the animation at phase 0 (solid dark block) before
//     the 50%-phase `inherit` ever shows — steady while codex streams, the
//     natural 1 Hz alive-cue pulse when codex idles. The falling edge
//     re-asserts `\u001b[?25h` and reaffirms `cursorBlink = true` so the
//     bare shell prompt keeps its M2 alive-cue blink.
  const tuiCursorStateRef = useRef<TuiCursorState>({ tuiRunning: false });
  // Layout-auto-launch latch — see TerminalPaneProps.cliId doc + the
  // `.then()` handler in the ptySpawn chain below. Flips true once the
  // auto-launch EITHER fires `${launchCommand}\r` OR writes the "not
  // installed" warning; never reset per-mount. A fresh TerminalPane mount
  // starts the ref at false, so re-applying a layout (which unmounts every
  // pane via hydrate's wholesale replace + a fresh freshPaneId per slot)
  // gives each new pane a one-shot auto-launch gate. The race window against
  // a chip-strip click of the SAME cliId is acceptable — the TUI latch
  // hides the chips once the CLI enters alt screen / Mode 2026, so the only
  // window for a double-fire is pre-spawn (no shell to receive the write).
  const autoLaunchedRef = useRef(false);
  // Mirror of `cliId` prop updated per-render into a ref, so the ptySpawn
  // `.then()` closure always sees the latest value even if the pane
  // re-renders between the effect firing and the spawn IPC resolving.
  // Layouts hydrate wholesale so cliId never mutates on a live pane in
  // practice — this ref is defensive belt-and-braces.
  const cliIdRef = useRef<string | null>(cliId ?? null);
  cliIdRef.current = cliId ?? null;
  // Set by onOsc133 if the OSC 133 stream produced a `commandEnd`/
  // `promptStart` DURING the current chunk's `terminal.write` parse while a
  // TUI was running — i.e. the shell just reclaimed the pane. Read + cleared
  // in the onPtyData watcher (cannot `terminal.write` out of the OSC handler
  // — xterm is mid-parse of the outer write there).
  const tuiExitRequestedRef = useRef(false);
  // Mode-2026 batcher for THIS pane. xterm.js v6 HONORS Mode 2026 natively
  // (`CoreService.decPrivateModes.synchronizedOutput` + `_syncOutputHandler.bufferRows`
  // + a 1 s safety timeout — verified at offset 181168/182927 of the installed
  // bundle), so each `?2026h…?2026l` frame is parsed to its end-state and
  // rendered once already. `batchSyncFrames` here is therefore a defensive
  // COALESCER (the cursor-blinder lever is the strip in (1) of this watcher
  // — `stripCursorVisibilityModes`): it bundles the PTY byte chunks that
  // arrive split across onData events into a single `terminal.write` per frame
  // so xterm's parser sees each frame's bytes in one parse pass. Depth +
  // pendings stay on the batcher (not scannable per chunk) so a `?2026h`/
  // `?2026l` split across onData chunks is handled by xterm's parser inside
  // the batched write, not by `includes()`.
  const syncBatcherRef = useRef<SyncBatcher>({
    depth: 0,
    pending: "",
    lastOutsideCup: null,
    lastBodyCup: null,
    outsideCupFresh: false,
    bodyCupFresh: false,
  });
  // TIMEOUT safety valve — if `SYNC_FLUSH_TIMEOUT_MS` ms pass after a `?2026h`
  // without the matching close (a runaway producer), flush the embargoed body
  // un-batched. Worst case degrades to the original flicker, never a stall.
  let syncFlushTimer: ReturnType<typeof setTimeout> | null = null;
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
    const onOsc133 = (data: string): boolean => {
      const event = parseOscPayload(`133;${data}`);
      if (event) {
        // Shell-prompt resumption is the inline TUI's exit signal. pwsh's
        // `function prompt` emits `133;D` (commandEnd) then `133;A`
        // (promptStart) the first time it runs after codex (an inline TUI —
        // NO `?1049l` to mirror) exits, so we'd otherwise never unlatch.
        // xterm parses COMPLETE sequences here even when an OSC is split
        // across onData chunks, which a raw `chunk.includes` in onPtyData
        // could miss — so this is the canonical exit path for codex. Guarded
        // by the latch so a bare-shell prompt (latch idle) is a no-op. We
        // only SET a flag here; the onPtyData watcher consumes it (no
        // `terminal.write` in the handler — xterm is mid-parse of the outer
        // write and re-entrant writes are undefined behavior).
        if (
          tuiCursorStateRef.current.tuiRunning &&
          (event.type === "commandEnd" || event.type === "promptStart")
        ) {
          tuiExitRequestedRef.current = true;
        }
        const prompt =
          event.type === "promptStart" ? terminal.registerMarker(0) : null;
        const exit =
          event.type === "commandEnd" ? terminal.registerMarker(0) : null;
        setBlockModel(paneId, (m) => handleOscEvent(m, event, { prompt, exit }));
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
    // single shared channel, so filter to THIS pane's events here. This watcher
    // is where three concerns converge (all algorithms deferred to pure helpers
    // in syncBatcher.ts so they're unit-testable without xterm/jsdom):
    //   (1) Cursor-visibility strip — the ACTUAL no-blink lever. codex emits
    //       each frame as `?2026h` → `?25l` → body → `?25h` → `ESC[0 q` →
    //       `?2026l`. Pairs INSIDE `?2026h`…`?2026l` collapse (xterm defers the
    //       render until `?2026l`, by which point `?25h` has re-shown), but ~1/3
    //       of the `?25h`/`?25l` pairs in the live capture (`.codex-capture2/`)
    //       land OUTSIDE sync frames where xterm renders IMMEDIATELY — each
    //       stray `?25l` paints cursor-HIDDEN, the next `?25h` paints it
    //       VISIBLE, at frame rate ⇒ the strobe the user calls "blinking the
    //       hell out". Bundle proof: `?25l`/`?25h` →
    //       `coreService.isCursorHidden = !0/!1`; `createRow` gates the cursor
    //       cell on `!isCursorHidden` LIVE per render (`xterm.js` ~181879 /
    //       ~180799 / ~85814). `terminal.options.cursorBlink=false` can't fix
    //       it — that flag only governs whether the `.xterm-cursor-blink`
    //       class is pushed (CSS @keyframes), NOT whether the cell paints.
    //       The fix: strip `?25h`/`?25l`/`?12h`/`?12l` from the chunk while the
    //       latch says a TUI owns the pane (prev running OR this chunk carries
    //       a takeover signal). `isCursorHidden` then stays at its initial
    //       `false` — at each flush xterm paints a STEADY inverse
//       `xterm-cursor-block`. Under the new design `cursorBlink=true` is
//       kept steady (no rising-edge flip — see (3) in the watcher below for
//       the live A/B verdict that retired the old false-flip), so the
//       focused pane pushes `.xterm-cursor-blink` AND the CSS
//       `@keyframes blink_block_* 1s step-end infinite` IS attached. Each
//       render rebuilds the cursor cell `<span>` from scratch; the fresh
//       @keyframes starts at phase 0 (BG = `theme.cursor`, solid dark) and
//       the next rebuild (~50 ms later for a 20 Hz TUI) supersedes it before
//       the 50% phase (`background-color: inherit`, blink-off) ever shows —
//       so while codex streams the cursor reads as a CONTINUOUS solid block,
//       and only when churn stops (idle) does the animation progress into
//       the 1 Hz alive-cue pulse the M2 "frozen" complaint asked for.
//       (That's also why `display:none` was wrong before — it nuked the
//       cursor cell's glyph and let codex's per-frame cursor CUP teleport
//       the "missing char" across the row, perceived as subtitle-text
//       blink.)
    //   (2) Mode-2026 coalescing — wraps each `?2026h`…`?2026l` frame's body
    //       in a single `terminal.write`. xterm v6 DOES honor Mode 2026 natively
    //       (`CoreService.decPrivateModes.synchronizedOutput` + a 1 s safety-
    //       timeout flush already collapses each frame's in-window
    //       intermediates), so this coalescing is DEFENSIVE — it just keeps a
    //       frame's bytes together in one parser pass even if ConPTY or
    //       node-pty chops a frame across multiple onData events (so a partial
    //       frame at a chunk boundary doesn't foul the OSC 133 / latch flows
    //       in this same watcher). A TIMEOUT safety valve force-flushes a
    //       frame left open >SYNC_FLUSH_TIMEOUT_MS so a runaway producer never
    //       stalls the pane; LENGTH + depth valves live in the pure helper.
    //   (3) TUI latch — enter on `?1049h` (alt-screen TUIs: opencode/claude)
    //       OR `?2026h` (codex's inline synced-output takeover, which the old
    //       `?1049h`-only latch MISSED); exit on `?1049l` OR an OSC 133
    //       commandEnd/promptStart (the shell prompt resuming — set by
    //       onOsc133 during the batched write). The wasRunning gate inside
//       applyTuiCursorStep keeps an enter this chunk from falsely firing
//       an exit on the same chunk. The latch drives the strip gate AND the
//       cursor-blink alive-cue restore below.
    const disposePtyData = window.bridge.onPtyData((evt) => {
      if (evt.paneId !== paneId) return;
      const chunkRaw = evt.data;

      // Latch pre-read — runs on the RAW chunk (before the strip below) so the
      // strip never hides the `?1049h`/`?2026h`/`?1049l` sequences the latch's
      // enter/exit detection is keyed on.
      const enterMode = detectTuiEnter(chunkRaw);
      const altExit = detectTuiAltExit(chunkRaw);

      // (1) Cursor-visibility strip. The strip applies to the chunk WHENEVER
      // a TUI owns the pane (the latch had `tuiRunning=true` at the start of
      // this chunk) OR this chunk carries a takeover signal (`enterMode !==
      // null` — the rising edge; the latch advances later but the strip
      // EMITTED-IN-THIS-CHUNK must include the TUI's FIRST in-frame `?25l`).
      // `applyTuiCursorStep` runs only after `terminal.write` (it needs the
      // post-write `oscExit` flag), so the strip gate reads the pre-write
      // latch state — but picks up the rising edge via `enterMode`. The
      // falling-edge chunk (the one containing the OSC 133 / `?1049l` that
      // BROUGHT the latch down) is ALSO stripped — TerminalPane re-asserts
      // `\u001b[?25h` via the `restoreBlink` branch below, so the cursor still
      // re-shows for the bare shell even though codex's own exit-time `?25h`
      // here was stripped.
      const stripActive =
        tuiCursorStateRef.current.tuiRunning || enterMode !== null;
      const chunk = stripActive
        ? stripCursorVisibilityModes(chunkRaw)
        : chunkRaw;

      // (2) Mode-2026 coalescing — batch the (possibly stripped) chunk ≥ the
      // `?2026h`/`?2026l` delimiters so xterm's parser sees each frame in one
      // pass even if ConPTY chops it across onData events. Depth lives on the
      // batcher so a `?2026h`/`?2026l` split across onData chunks is restitched
      // by xterm's parser inside `terminal.write`, not by `includes()` here.
      //
      // Capture the batcher's depth BEFORE `batchSyncFrames` runs — the (3a)
      // hide-on-open below needs to know whether this chunk's body bytes are
      // processed INSIDE an inherited open frame, and `batched.hasOpenFrame`
      // alone isn't enough (it only reports post-batch depth; the open+close-
      // in-one-chunk case has `hasOpenFrame=false` but body bytes DID paint
      // inside a frame). `depthBefore` is a no-cost witness captured before
      // the call mutates `batcher.depth`.
      const depthBefore = syncBatcherRef.current.depth;
      const batched = batchSyncFrames(syncBatcherRef.current, chunk);

      // TIMEOUT valve: a frame just OPENED (or stayed open) — arm/refresh the
      // force-flush timer; CLOSED — disarm it. The timer fires the batcher's
      // flushSyncBatcher (an exhaustion flush) so the pane never wedges.
      if (batched.hasOpenFrame) {
        if (syncFlushTimer) clearTimeout(syncFlushTimer);
        syncFlushTimer = setTimeout(() => {
          syncFlushTimer = null;
          const { flushed } = flushSyncBatcher(syncBatcherRef.current);
          if (flushed) terminal.write(flushed);
        }, SYNC_FLUSH_TIMEOUT_MS);
      } else if (syncFlushTimer) {
        clearTimeout(syncFlushTimer);
        syncFlushTimer = null;
      }

      // (3a) HIDE the cursor BEFORE xterm processes the body paint. The body
      // bytes carry codex's CUPs through the footer workspace row (23;52), the
      // streaming response row (18;col advancing), the working banner — if the
      // cursor stays visible during body processing xterm leaves the cursor at
      // body-lastCup at sync close → that row paints the cursor cell → the
      // user-visible "blinker hopping around the working tag, the footer, the
      // response row" complaint. We write `?25l` BEFORE the for-loop's emits so
      // `coreService.isCursorHidden` resolves true before xterm parses the body
      // (the strip in (1) already removed codex's own `?25h` from the body, so
      // nothing inside can flip it back). After the for-loop, (3b) re-anchors +
      // re-shows at codex's stable prompt cell — the cursor cell paints ONLY
      // there while codex streams.
      //
      // Two cases for "this chunk paints body inside an open sync frame":
      //   1) `depthBefore > 0` — a frame was already open when this chunk
      //      arrived (ConPTY chopped the body across onData boundaries), so the
      //      chunk continues painting inside that open frame even though it may
      //      not open a fresh one (and `batched.hasOpenFrame===false` if it
      //      then closed the inherited frame in this same chunk — that's why we
      //      need the `depthBefore` witness, not `batched.hasOpenFrame`).
      //   2) `chunk.includes(SYNC_OPEN)` — this chunk opens a frame itself
      //      (regardless of whether that frame ALSO closes inside the same
      //      chunk for the single-emit open+close case the batcher handles).
      //
      // The `SYNC_OPEN` check rides on the (1) STRIPPED chunk — the strip only
      // removes `?25h`/`?25l`/`?12h`/`?12l`, never the `?2026h`/`?2026l` sync
      // delimiters, so the opener survives the strip intact. `!stripActive`
      // outside a TUI run falls through to the bare-shell path — xterm's own
      // cursor blink is untouched.
      if (
        stripActive && (depthBefore > 0 || chunk.includes(SYNC_OPEN))
      ) {
        (terminal as unknown as { write(data: string): void }).write("\u001b[?25l");
      }

      // The OSC handler clears this right before each write, then sets it
      // if a commandEnd/promptStart parsed DURING the write while a TUI was
      // running. So reset → write → read.
      tuiExitRequestedRef.current = false;
      for (const out of batched.emits) terminal.write(out);
      const oscExit = tuiExitRequestedRef.current;

      // (2)+(3) run the pure latch state machine on the chunk-level inputs +
      // the OSC-exit flag (set by xterm's parser, robust to split escapes).
      const { next, actions } = applyTuiCursorStep(
        tuiCursorStateRef.current,
        { enterMode, altExit, oscExit },
      );
      tuiCursorStateRef.current = next;

      // Side-effect ordering on the latch's edges:
      //   - Rising edge (`actions.markEntered`): fire `markTuiEntered` so
      //     the chip strip auto-hides (the user can't fire `${cli}\r` into a
      //     running TUI's stdin). NO cursor write here — visibility is
      //     decided per sync frame by the (3a) hide-on-open above and the
      //     (3b) anchor+show-on-close below (the blanket-hide-on-enter of
      //     the old design is retired — it suppressed the alive-cue
      //     entirely AND didn't fix the hopping since codex's body paint
      //     still touched the cursor cell).
      //   - Falling edge (`actions.markExited`): fire `markTuiExited` so
      //     the chip strip reappears.
      //   - Falling edge's cursor write (`actions.restoreBlink`): write
      //     `\u001b[?25h` so the cursor re-shows for the bare shell prompt +
      //     reaffirm `cursorBlink = true` so the bare-shell M2 alive-cue
      //     blink restarts.
      if (actions.markEntered) markTuiEntered(paneId); // chip strip hides
      if (actions.markExited) markTuiExited(paneId); // chip strip reappears
      // (3b) After a sync close INSIDE the TUI-owned pane, RE-ANCHOR + SHOW
      // the cursor at codex's own prompt-input cell. The cursor ends up at
      // body-lastCup (= footer row 23;52, the streaming response row 18;col
      // advancing, or the working banner) at sync close because codex's
      // body paint CUPs through those rows. If we let xterm render that,
      // the cursor cell would paint there briefly → the "blinker hops onto
      // the working tag, the footer, the response row" symptom the user
      // described. The body is gated HIDDEN by (3a)'s pre-loop `?25l`, so
      // the cell ONLY ever paints at the stable cell we anchor here.
      //
      // Why a programmatic anchor instead of leaving codex's own
      // outside-sync `CUP <row>;<col> ?25h` re-anchor pulse to do the work:
      // codex DOES emit that pulse after every sync close (per the live
      // capture in `__codex_probe.log` — 33 of 36 outside-sync shows pair
      // with `CUP 21;3` during streaming, `CUP 17;3` in the early banner
      // phase), but it lands AFTER xterm has already rendered the
      // body-lastCup cell visible at sync close. We strip codex's `?25h` in
      // (1), so even preserving codex's `CUP 21;3` would still leave the
      // cursor invisible between sync closes — the OLD idle-aware valve's
      // "no blinker while codex streams" complaint. So we re-issue the
      // anchor+show OURSELVES here, IN THE SAME render batch as the
      // body-close emit (the for-loop just finished feeding the body bytes
      // to xterm; xterm's DomRenderer batches via requestAnimationFrame, so
      // this write coalesces with the close into ONE render commit), at the
      // SAME cell codex would use (the anchor comes from
      // `SyncBatcher.lastOutsideCup`, which the batcher harvests from
      // codex's own outside-sync CUPs via `scanOutsideCups`).
      //
      // The cell thus stays at a single stable position across every cycle:
      // the cursor element's `top`/`left` CSS isn't actually changing
      // (same `(21, 3)` every cycle), so xterm's `DomRenderer` doesn't
      // recreate the cursor's `<span>` → CSS `@keyframes blink_block_* 1s
      // step-end infinite` keeps its phase → the 1 Hz alive-cue pulse runs
      // smoothly. Steady visible blinker at the prompt input cell THROUGH
      // codex's entire streaming + idle + working cycle — the user's "make
      // it stay" ask.
      //
      // (3b) is a 3-WAY discriminator over this chunk's CUP profile, because
      // the steady-blinker architecture above was built to fix a DIFFERENT bug
      // (the STREAMING-cycle body-lastCup hop — the cursor painting at the
      // footer / the streaming response row while codex streams) from the one
      // this discriminator exists to fix: the TYPING-cycle bad snap. When the
      // user types into a running codex/opencode prompt, the producer does NOT
      // re-issue codex's per-close outside-sync re-anchor pulse — it just
      // repaints the prompt with the new char. codex does that INSIDE a
      // `?2026h`…`?2026l` frame whose body CUP re-positions the cursor at the
      // cell AFTER the typed char; opencode does it OUTSIDE the frame with NO
      // CUP at all (pure text-echo advance — xterm's own write advances the
      // cursor one cell along). So `batcher.lastOutsideCup` stays STALE during
      // typing — still pinned to the pre-typing prompt-input start, where the
      // FIRST typed char is painted. The old (3b) wrote
      // `\u001b[<stale-anchor>H\u001b[?25h` unconditionally and snapped the
      // cursor BACK onto the just-typed char ("blinker on H when I type Hi")
      // — the exact complaint this discriminator was built to undo.
      //
      // Three classes, classified by `batched.outsideCupFresh` /
      // `batched.chunkHadCup` (reset fresh-per-call by syncBatcher's
      // `scanOutsideCups` / `scanInsideCups`):
      //
      //   outsideCupFresh === true
      //     → STREAMING single-chunk. codex/opencode's per-close outside-sync
      //       re-anchor pulse arrived THIS chunk. Pin the cursor at the FRESH
      //       `lastOutsideCup` cell (the steady-blinker path — anchor+show at
      //       the stable prompt cell). This is the case the test "hides
      //       cursor on sync-open ... + programmatic `CUP <anchor>;?25h`
      //       re-anchor+show on sync-close inside TUI" pins, so existing
      //       codex-streaming coverage keeps holding.
      //
      //   outsideCupFresh === false, chunkHadCup === true
      //     → TYPING (codex body has a CUP at the prompt row) OR STREAMING-
      //       SPLIT chunk N (body painted this chunk, outside-pulse lands in
      //       the NEXT chunk). Distinguished by a row-match heuristic against
      //       `lastBodyCup` (the LAST INSIDE-sync CUP the batcher scanned):
      //         - lastBodyCup.row == lastOutsideCup.row (OR lastOutsideCup is
      //           still null) → TYPING. The body just advanced the cursor to
      //           the cell after the typed char; trust it — anchor to
      //           lastBodyCup so the cursor sits AFTER the char, not ON it
      //           (the "make it stay after H" fix).
      //         - lastBodyCup.row != lastOutsideCup.row → STREAMING-SPLIT.
      //           The body painted the footer / response row this chunk; the
      //           outside re-anchor arrives next. Trust the STALE
      //           lastOutsideCup (= the same cell the fresh outside-pulse
      //           will reconfirm next chunk) so the cursor doesn't hop to the
      //           footer — the original streaming hop the steady-blinker
      //           architecture above was built to mask.
      //
      //   outsideCupFresh === false, chunkHadCup === false
      //     → no CUP scanned THIS call. Two sub-cases distinguished by the
      //       PERSISTENT `lastBodyCup` (preserved across `batchSyncFrames`
      //       calls — used here, NOT the per-call `chunkHadCup`, because the
      //       SPLIT-cycle teleporter's body CUPs were scanned into
      //       `lastBodyCup` during the PREVIOUS chunk's open-frame call, then
      //       that chunk's `?2026l` close arrived alone in THIS chunk):
      //         - lastBodyCup != null → SPLIT-cycle SPLIT-streaming teleporter
      //           OR SPLIT-typing. codex OPENED a sync frame with body paint
      //           in chunk N (`scanInsideCups` harvested the body's CUPs into
      //           `lastBodyCup`; body accumulated into `pending`), then CLOSED
      //           with `?2026l` alone in chunk N+1 (THIS chunk —
      //           `scanInsideCups("")` finds nothing → `bodyCupFresh` resets
      //           → `chunkHadCup=false` THIS call even though `lastBodyCup`
      //           STILL holds the body's off-prompt cell from chunk N). Drive
      //           the SAME row-match heuristic as the `chunkHadCup=true`
      //           middle branch: row match → SPLIT-typing (anchor to
      //           `lastBodyCup` — cursor AFTER the just-typed char); row
      //           mismatch → SPLIT-streaming teleporter (anchor to the
      //           stable `lastOutsideCup` so the cursor PINNED to the prompt
      //           cell at the SAME rAF commit as the close flush → no
      //           interim body-lastCup render → fixes the two-commits-two-
      //           rows "teleporter blinker" symptom the user reported).
      //         - lastBodyCup == null → no inside-sync body paint EVER scanned
      //           in this pane (opencode's empty-sync-pair keystroke echo: the
      //           char is written OUTSIDE-frame with NO CUP, xterm's own
      //           write advances the cursor one cell along). Don't move the
      //           cursor — write `?25h` only so xterm's naturally-advanced
      //           cell stands (NOT snapped back to the stale outside cell).
      //
      // `null lastOutsideCup` (the absolute first codex frame, before codex
      // has emitted any outside-sync CUP — the first ~80ms of a session) is
      // folded into the heuristic's `!outside || ...` guard: anchor to body-
      // lastCup for one legacy flicker cycle; `scanOutsideCups` populates
      // lastOutsideCup on the next streaming chunk and the policy locks in.
      if (stripActive && batched.emits.some((e) => e.includes(SYNC_CLOSE))) {
        const write = (s: string) =>
          (terminal as unknown as { write(data: string): void }).write(s);
        if (batched.outsideCupFresh) {
          // STREAMING single-chunk — fresh outside-sync re-anchor pulse.
          // Pin the cursor at the stable prompt cell (steady-blinker path).
          const anchor = syncBatcherRef.current.lastOutsideCup;
          if (anchor) {
            write(`\u001b[${anchor.row};${anchor.col}H\u001b[?25h`);
          } else {
            write("\u001b[?25h");
          }
        } else if (batched.chunkHadCup) {
          // TYPING (codex body CUP at prompt row) OR STREAMING-SPLIT chunk N.
          // Row-match heuristic picks body-lastCup when it shares the prompt's
          // row (typing — trust the body's natural advance), else the stale
          // outside anchor (split — stable until the outside-pulse arrives).
          const outside = syncBatcherRef.current.lastOutsideCup;
          const bodyLast = syncBatcherRef.current.lastBodyCup;
          let anchor: { row: number; col: number } | null = outside;
          if (bodyLast && (!outside || bodyLast.row === outside.row)) {
            anchor = bodyLast;
          }
          if (anchor) {
            write(`\u001b[${anchor.row};${anchor.col}H\u001b[?25h`);
          } else {
            write("\u001b[?25h");
          }
        } else {
          // chunkHadCup=false THIS call, but the persistent `lastBodyCup`
          // may STILL hold chunk N's body cell (the SPLIT-cycle teleporter —
          // body painted in chunk N, `?2026l` alone in chunk N+1; see the
          // third-class summary above). Mirror the middle branch's row-match
          // heuristic on the persistent cups so the close-flush pins the
          // cursor at ONE cell in ONE rAF commit (no interim body-lastCup
          // paint). `lastBodyCup==null` → opencode text-echo fallthrough
          // (write `?25h` only — xterm's natural advance already positioned
          // the cursor; don't snap it back onto the just-typed char).
          const outside = syncBatcherRef.current.lastOutsideCup;
          const bodyLast = syncBatcherRef.current.lastBodyCup;
          if (bodyLast) {
            let anchor: { row: number; col: number } | null = bodyLast;
            if (outside && bodyLast.row !== outside.row) {
              // row mismatch → SPLIT-streaming teleporter: anchor the STABLE
              // outside so the cursor snaps back to the prompt cell at the
              // close flush's rAF (this is the actual teleporter fix).
              anchor = outside;
            }
            // row match → SPLIT-typing: anchor bodyLast so the cursor sits
            // AFTER the just-typed char (NOT snapped onto it).
            // `!outside` (the very first codex chunk before any outside-sync
            // CUP) folds into the row-match path — anchor bodyLast until the
            // first outside sync stream pulse populates `lastOutsideCup`.
            write(`\u001b[${anchor.row};${anchor.col}H\u001b[?25h`);
          } else {
            // No inside-sync body paint ever scanned in this pane — opencode
            // typing (char wrote outside-frame, xterm advanced naturally), or
            // the absolute first codex chunk before any body paint landed.
            write("\u001b[?25h");
          }
        }
      }
      if (actions.restoreBlink) {
        (terminal as unknown as { write(data: string): void }).write("\u001b[?25h");
        terminal.options.cursorBlink = true;
      }
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
        // .catch (6b): the backend `requireSession` throws "no session for
        // pane" if a kill raced the spawn (or a respawn evicted a generation
        // without the RO having observed the pty:exit yet) — swallowing the
        // rejection prevents an unhandled renderer rejection that would
        // surface as a noisy console stack with no user recourse.
        void window.bridge.ptyResize(paneId, t.cols, t.rows).catch(() => {});
      }, RESIZE_DEBOUNCE_MS);
    });
    ro.observe(host);

    // PTY exit teardown (6c). Done HERE — inside the mount effect, after `ro`
    // + `resizeTimer` are initialized — rather than deferred to the unmount
    // cleanup, because the dead pane STAYS mounted (the user may re-launch
    // elsewhere or just read the dead buffer). While mounted, the existing
    // ResizeObserver would fire `fit()` on RO triggers and dispatch ptyResize
    // against a Backend session that no longer exists (kill() deleted it
    // synchronously, AND the backend's own pty.onExit is async-delayed on
    // ConPTY). Reset the RO guards (aliveRef + spawnedRef → false) so the RO
    // callback's preflight check fails fast, drop the RO so no more
    // observations fire, and clear any in-flight debounced fit(). Unmount
    // cleanup still calls ro.disconnect() (now idempotent — disposing an
    // already-disconnected RO is a no-op).
    const disposePtyExit = window.bridge.onPtyExit((evt) => {
      if (evt.paneId !== paneId) return;
      markExited(paneId, evt.exitCode);
      aliveRef.current = false;
      spawnedRef.current = false;
      if (resizeTimer) {
        clearTimeout(resizeTimer);
        resizeTimer = null;
      }
      try {
        ro.disconnect();
      } catch {
        // already disconnected during a prior unmount; ignore.
      }
    });

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
        // Layout-auto-launch — fire the pane's bound CLI exactly once after
        // the shell spawned. This is the layout-derived equivalent of the
        // chip-strip click in TerminalNode: the same
        // `ptyWrite(launchCommand\r)` primitive, gated by `autoLaunchedRef`
        // so the write never fires twice. If the bound CLI id isn't in the
        // (currently) installed set (the user's PATH changed since the layout
        // was designed, or the layout referenced a CLI this machine doesn't
        // have) we DON'T silently retry — write a one-line yellow warning so
        // the user knows the pane is raw shell and the chip strip stays live
        // for a manual launch. The cursor strip / TUI latch machinery is NOT
        // touched by this branch — it runs the same whether or not the pane
        // auto-launched a CLI (the prior cursor architecture stays
        // untouched).
        if (!autoLaunchedRef.current && cliIdRef.current != null) {
          autoLaunchedRef.current = true;
          const tool = useCliToolsStore
            .getState()
            .cliTools.find((c) => c.id === cliIdRef.current);
          if (tool) {
            void window.bridge.ptyWrite(paneId, `${tool.launchCommand}\r`);
          } else {
            (terminal as unknown as { writeln(data: string): void }).writeln(
              `\x1b[33m[mapw] layout CLI "${cliIdRef.current}" not installed; pane is in raw shell.\x1b[0m`,
            );
          }
        }
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
          // .catch (6b): symmetric with the RO path — a stale-session
          // rejection here would otherwise be an unhandled rejection.
          void window.bridge.ptyResize(paneId, term.cols, term.rows).catch(() => {});
        }
        // Record the dims the PTY now has so the ResizeObserver's first fire
        // (and every subsequent identical-fit fire) skips the redundant resize
        // IPC that would otherwise trip a needless TUI redraw.
        lastResizeRef.current = { cols: term.cols, rows: term.rows };
        term.focus();
      })
      .catch((err: unknown) => {
        // A failed spawn (e.g. shell missing) keeps the pane mounted so the
        // user sees the inline error instead of a vanishing node. Mark it
        // dead (-1 sentinel) so the pane's exit-code chip surfaces the
        // failure; the TUI latch stays idle so the chip strip
        // stays visible — if the user manages to open a different shell
        // elsewhere, the chips remain ready to fire.
        if (aliveRef.current) {
          terminal.writeln(
            `\x1b[31m[mapw] pty spawn failed: ${(err as Error).message}\x1b[0m`,
          );
        }
        markExited(paneId, -1);
      });

    return () => {
      aliveRef.current = false;
      spawnedRef.current = false;
      // Tear down the sync-batching + cursor-blink-gate machinery: cancel the
      // TIMEOUT valve, drop any embargoed frame body (the terminal is being
      // disposed — those bytes would never render anyway), unlatch the TUI
      // state, and restore cursorBlink so a re-mount on the same paneId starts
      // the shell with its blink alive-cue intact.
      if (syncFlushTimer) {
        clearTimeout(syncFlushTimer);
        syncFlushTimer = null;
      }
      syncBatcherRef.current = {
        depth: 0,
        pending: "",
        lastOutsideCup: null,
        lastBodyCup: null,
        outsideCupFresh: false,
        bodyCupFresh: false,
      };
      tuiCursorStateRef.current = { tuiRunning: false };
      tuiExitRequestedRef.current = false;
      try {
        (terminal as unknown as { write(data: string): void }).write("\x1b[?25h");
        terminal.options.cursorBlink = true;
      } catch {
        // terminal already disposed during StrictMode's earlier cycle
      }
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

  // Re-apply font + refit on every font change (6a). Fit alone leaves the
  // backend PTY grid permanently desynced: a font change alters cell metrics →
  // fit() re-packs cols/rows against the SAME `.pane__host` border-box (the
  // box doesn't change size on a font change, so the existing ResizeObserver
  // never fires) → the new cols/rows land in xterm but NEVER reach the backend
  // PTY, so the running shell lays out at the OLD geometry while xterm wraps at
  // the NEW → garbled wrap and broken full-screen TUIs (htop / vim). This
  // effect is the ONLY catch-up path. Gate by the preflight refs (aliveRef +
  // spawnedRef, both reset by the onPtyExit teardown above) so a dead pane
  // doesn't ping a stale session, and skip the redundant IPC when the new
  // dims match the last dispatched set. .catch (6b) mirrors the RO path —
  // the backend's "no session for pane" rejection stays swallowed rather than
  // surfacing as an unhandled renderer rejection.
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.fontFamily = `${fontFamily}${MONO_FALLBACK}`;
    termRef.current.options.fontSize = fontSize;
    try {
      fitRef.current?.fit();
    } catch {
      // ignore fit races during teardown
    }
    const t = termRef.current;
    if (t && aliveRef.current && spawnedRef.current) {
      const last = lastResizeRef.current;
      if (!last || last.cols !== t.cols || last.rows !== t.rows) {
        lastResizeRef.current = { cols: t.cols, rows: t.rows };
        void window.bridge.ptyResize(paneId, t.cols, t.rows).catch(() => {});
      }
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
