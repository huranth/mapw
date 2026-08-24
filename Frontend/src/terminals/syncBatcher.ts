// Stream-level helpers for full-screen / inline TUI rendering under xterm.js,
// kept PURE (no node:fs / no xterm import) so they're unit-testable the same
// way shellIntegration's rc builders + codexThemeMerge's TOML merge are. Three
// independent concerns live here:
//
// (1) Cursor-visibility strip — the ACTUAL no-blink lever. codex (per the live
//     capture in `.codex-capture2/` — 25 `?2026h`/`?2026l` frame pairs and
//     37 `?25h`/`?25l` pairs in 30 s) emits EACH frame as
//     `?2026h` → `?25l` (hide cursor) → body → `?25h` (show cursor) → `ESC[0 q`
//     → `?2026l`. The `?25h`/`?25l` pairs INSIDE the `?2026h`…`?2026l` window
//     collapse (xterm defers the render until `?2026l`, then `?25h` has already
//     re-shown the cursor at flush). But ~12 of the 37 pairs land OUTSIDE sync
//     frames in the capture — and OUTSIDE `?2026h`/`?2026l`, xterm renders
//     IMMEDIATELY, so each stray `?25l` paints the screen cursor-HIDDEN and the
//     next `?25h` paints it cursor-VISIBLE. At frame rate those alternating
//     immediate paints are the visible strobe the user calls "blinking the
//     hell out" — driven by codex's own `coreService.isCursorHidden` toggles,
//     NOT by xterm's CSS `@keyframes`.
//
//     Bundle proof (xterm v6, `node_modules/@xterm/xterm/lib/xterm.js`):
//       - `?25l` → `case 25: this._coreService.isCursorHidden = !0;` (~181879)
//       - `?25h` → `case 25: this._coreService.isCursorHidden = !1;` (~180799)
//       - `createRow` cursor-cell gate (~85814):
//               `!this._coreService.isCursorHidden && H && isCursorInitialized
//                → I.push("xterm-cursor"); [isFocused && cursorBlink &&
//                I.push("xterm-cursor-blink")], I.push("xterm-cursor-block")`
//     So `isCursorHidden` reads LIVE every render; flipping it false/true at
//     frame rate repainting the cursor cell visible/invisible — that is the
//     strobe. `terminal.options.cursorBlink=false` cannot fix it: that option
//     only governs whether the `.xterm-cursor-blink` CLASS is pushed (and
//     therefore whether the CSS `@keyframes` ever attaches), NOT whether the
//     cell paints at all. The class is already dropped after codex's per-frame
//     `ESC[0 q` (DECSCUSR 0 → `decPrivateModes.cursorBlink = void 0`,
//     ~187702, so the renderer's `n = decPrivateModes.cursorBlink ??
//     rawOptions.cursorBlink` falls through to our `false`).
//
//     The fix: strip `?25h` / `?25l` from the PTY stream while the TUI latch
//     says a TUI owns the pane — `isCursorHidden` then stays at its initial
//     `false` (cursor visible) forever, at each flush xterm paints a STEADY
//     inverse `xterm-cursor-block` (with `cursorBlink=false` there's no
//     `.xterm-cursor-blink` so no `@keyframes` runs) — solid block, no strobe,
//     no per-frame glyph-hop side-effect (that's why `display:none` was wrong
//     before — it nuked the cell's glyph and let codex's per-frame cursor CUP
//     teleport the missing character across the row "subtitle blinking").
//     `?12h` / `?12l` (DECSDM cursor-blink-mode) are stripped too as defense:
//     codex's capture emits ZERO of them, but `?12h` writes
//     `optionsService.options.cursorBlink = !0` through the OptionsProxy setter
//     (~179889) which would RE-ARM the CSS `@keyframes` via the option-change
//     event — strip first so neither current nor future TUIs can resurrect it.
//
// (2) Mode-2026 (synchronized output) frame coalescer. codex (and any Bubble
//     Tea/ratatui program that enables synced output) wraps each repaint in
//     `?2026h` … `?2026l` so the terminal defers rendering until the frame's
//     `?2026l`. xterm.js v6 DOES honor Mode 2026 natively — verified in the
//     bundle: `case 2026: decPrivateModes.synchronizedOutput = !0/!1;`
//     (~181172 / ~182931), and the renderer's
//     `_renderRows` diverts into `_syncOutputHandler.bufferRows` while the
//     flag is set (~111080 / ~111399), with a 1 s window.setTimeout that
//     clears the flag and force-flushes (~114288). So xterm ALREADY defers
//     per-frame intermediates INSIDE the sync window. `batchSyncFrames` is
//     therefore NOT what collapses the in-frame `?25l`/`?25h` cycle — xterm
//     does that. Its job is to coalesce PTY byte chunks that arrive split
//     across onData events into a SINGLE `terminal.write` per frame so the
//     parser sees each frame's bytes in one parse pass. Both `flushSyncBatcher`'s
//     1 s timeout valve + the `SYNC_FLUSH_MAX_LENGTH` length valve live
//     alongside xterm's own 1 s Mode 2026 timeout without conflict.
//
// (3) TUI-latch state machine. Drives two side effects in TerminalPane:
//   - the chip-strip auto-hide (markTuiEntered/Exited, so the user can't fire
//     `${cli}\r` into a running TUI's stdin);
//   - the moment (1)'s strip turns ON/OFF. The latch keys on `?1049h` (alt-
//     screen TUIs: opencode/claude) OR `?2026h` (codex's inline synced-output
//     takeover; codex renders INLINE and never touches alt screen, so a
//     `?1049h`-only latch misses codex entirely). Exit keys on `?1049l` (alt-
//     screen leave) OR on the shell prompt resuming (OSC 133 `commandEnd` /
//     `promptStart` — pwsh's `function prompt` emits `133;D`+`133;A` the first
//     time it runs after the inline TUI's process exits).
//
// The blink-edge signals (`suppressBlink` / `restoreBlink` below) reflect the
//     latch's rising/falling edge; their CONSUMER decides what (if anything)
//     to do on each. Today only `restoreBlink` is consumed (by TerminalPane
//     writing `\u001b[?25h` + reaffirming `cursorBlink = true` on the falling
//     edge so the bare shell prompt keeps its M2 alive-cue). The rising-edge
//     `suppressBlink` is now a no-op in TerminalPane: under the new design
//     `cursorBlink=true` is held steady through codex's run because xterm's
//     DomRenderer rebuilds the cursor cell per render frame, starting the
//     1 s `@keyframes blink_block_*` animation at phase 0 (solid dark) on
//     each fresh element; the 50%-phase `background-color: inherit` never
//     shows while codex churns (~50 ms rebuild interval vs 500 ms phase
//     midpoint) ⇒ the cursor stays a steady dark block while streaming, and
//     naturally surfaces the 1 Hz alive-cue pulse when codex goes idle (no
//     churn → animation advances). See TerminalPane's `(3)` block for the
//     empirical A/B. `suppressBlink` stays in the contract so the existing
//     tests stay honest about the latch's transitions. See
//     `tests/syncBatcher.test.ts` for the algorithm's behavioral contract.

export const SYNC_OPEN = "\x1b[?2026h";
export const SYNC_CLOSE = "\x1b[?2026l";

export const ALT_SCREEN_ENTER = "\x1b[?1049h";
export const ALT_SCREEN_LEAVE = "\x1b[?1049l";

/** DECTCEM — DEC text cursor enable mode (private mode 25). `?25h` shows the
 *  cursor (sets `coreService.isCursorHidden = false`), `?25l` hides it
 *  (`isCursorHidden = true`). codex emits BOTH per-frame; we strip both so
 *  `isCursorHidden` freezes — see the header. */
export const DECTCEM_SHOW = "\x1b[?25h";
export const DECTCEM_HIDE = "\x1b[?25l";

/** DECSDM — DEC cursor blink mode (private mode 12). `?12h` writes
 *  `optionsService.options.cursorBlink = true` through the per-key OptionsProxy
 *  setter, which propagates to `rawOptions.cursorBlink` AND fires
 *  `onOptionChange("cursorBlink")` → the DomRenderer regenerates CSS + the
 *  orchestrator forces a redraw with the `.xterm-cursor-blink` class pushed.
 *  codex emits ZERO of these (verified in `.codex-capture2/`), but we strip them
 *  too — future TUIs that DO use DECSDM would otherwise resurrect the CSS
 *  @keyframes blink we suppressed by setting `cursorBlink = false`. */
export const DECSDM_ON = "\x1b[?12h";
export const DECSDM_OFF = "\x1b[?12l";

/** Strip the cursor-visibility / cursor-blink private-mode escapes from a PTY
 *  chunk. Used by TerminalPane's watcher WHILE `tuiRunning` is true (per the
 *  latch in `applyTuiCursorStep`) so codex's per-frame `?25l`/`?25h`
 *  refresh-strobe cannot drive `coreService.isCursorHidden` true/false — see
 *  the bundle offsets + the empirical capture in the file header. PURE: same
 *  string in, same string out minus the four escapes; everything else (CUP,
 *  body content, SGR, OSC, other CSI) passes through verbatim.
 *
 *  Only the four exact byte sequences are removed — codex emits these without
 *  parameters; a hypothetical `?25;1h` form would survive, but that form is not
 *  part of the DECTCEM spec and codex's capture excludes it. */
export function stripCursorVisibilityModes(chunk: string): string {
  // The `\?12|25` alternation matches both DECTCEM (25) and DECSDM (12); the
  // trailing `[hl]` covers both set (h) and reset (l) final bytes. Anchoring the
  // regex on `\x1b\[` (ESC + [) means a stray bare `?25h` inside prompt TEXT
  // is never affected (it lacks the ESC lead-in).
  return chunk.replace(/\x1b\[\?(?:12|25)[hl]/g, "");
}

/** CUP — Cursor Position (`ESC [<row>;<col> H`, CSI with final byte `H`).
 *  codex uses CUP both INSIDE sync frames (painting body cells — the response
 *  row at col-advancing, the footer workspace row at 23;52) AND OUTSIDE sync
 *  frames (its prompt-input re-anchor pulse — `CUP 21;3` after every sync
 *  close, the 'cursor goes here at the prompt' piece of the per-frame
 *  cycle). The OUTSIDE-sync CUPs are what `scanOutsideCups` below harvests.
 *  `?` is NOT part of CUP's params (CUP isn't a private mode), so the regex
 *  matches the CUP pattern VERBATIM with no `?` prefix. */
const CUP_RE = /\x1b\[(\d+);(\d+)H/g;

/** Scan a chunk known to land OUTSIDE any sync frame (a passthrough slice)
 *  for Cursor Position escapes and remember the LAST one on the batcher.
 *  TerminalPane uses it as the "anchor cell" for its programmatic
 *  `\u001b[<row>;<col>H\u001b[?25h` write after each inside-TUI sync-close:
 *  codex's own stable prompt-input cell. Per the live capture in
 *  `__codex_probe.log` (33 of 36 outside-sync shows pair with CUP 21;3),
 *  codex emits one such CUP after EVERY sync close ⇒ the anchor is ALWAYS
 *  fresh. CUPs inside a sync frame (body paint) are NEVER seen here — they
 *  live on the depth>0 path where `batchSyncFrames` does NOT call this
 *  helper — so body-lastCup (footer 23;52, response row 18;col) can never
 *  contaminate the anchor. */
function scanOutsideCups(slice: string, batcher: SyncBatcher): void {
  const re = new RegExp(CUP_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    const row = parseInt(m[1] ?? "", 10);
    const col = parseInt(m[2] ?? "", 10);
    if (row > 0 && col > 0) {
      batcher.lastOutsideCup = { row, col };
      // Mark fresh-THIS-CALL so TerminalPane's (3b) knows the outside-sync
      // anchor ARRIVED in this chunk (codex/opencode's per-close re-anchor
      // pulse) and pins the cursor to it — the streaming-cycle path. Reset
      // to false at the top of every `batchSyncFrames` call (see below), so a
      // typing chunk that emits no outside-sync CUP reads `outsideCupFresh`
      // as false and falls through to the body-anchor heuristic / no-CUP
      // branches instead.
      batcher.outsideCupFresh = true;
    }
  }
}

/** Mirror of `scanOutsideCups` for the INSIDE-sync-frame bodies `batchSyncFrames`
 *  accumulates into `pending`. Tracks `lastBodyCup` — the most recent CUP the
 *  producer painted INSIDE a `?2026h`…`?2026l` frame (codex's body paint:
 *  the streaming response row advancing, the footer workspace row at 23;52,
 *  the working banner, AND during a typing cycle the CUP that re-positions the
 *  cursor at the cell-after-the-just-typed-char). Freshness (`bodyCupFresh`)
 *  reports whether THIS call observed ANY body CUP, so TerminalPane's (3b)
 *  discriminator can tell:
 *    * a TYPING cycle (a body CUP at the prompt-input row — cursor should
 *      advance naturally to body-lastCup and STAY there, NOT snap back to the
 *      stale outside anchor that's still pinned to the pre-typing prompt cell
 *      — the user's "blinker on the just-typed H" complaint);
 *    * a STREAMING-SPLIT cycle (body painted a DIFFERENT row this chunk
 *      because the outside re-anchor pulse hasn't arrived yet — keep the
 *      stable stale outside anchor so the cursor doesn't hop to body-lastCup
 *      on the footer row);
 *  from a no-CUP pure text-echo advance (opencode typing — let xterm's own
 *  cursor advance stand). Inside-sync body CUPs NEVER touch `lastOutsideCup`
 *  — only this helper scans them, and the depth=0 outside path never sees
 *  them — so the body anchor can't pollute the outside anchor (the original
 *  "footer row 23;52 contaminating the prompt-input cell" symptom). */
function scanInsideCups(slice: string, batcher: SyncBatcher): void {
  const re = new RegExp(CUP_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    const row = parseInt(m[1] ?? "", 10);
    const col = parseInt(m[2] ?? "", 10);
    if (row > 0 && col > 0) {
      batcher.lastBodyCup = { row, col };
      batcher.bodyCupFresh = true;
    }
  }
}

/** A full-screen TUI's takeover signal. `"alt"` = the alt-screen enter
 *  (`?1049h`) opencode/claude/etc. emit; `"sync"` = the Mode-2026 synced-output
 *  opener (`?2026h`) codex emits (it renders inline and never touches alt
 *  screen). `null` = this chunk carries no takeover signal. */
export type TuiEnterMode = "alt" | "sync" | null;

export interface TuiCursorState {
  /** True while a full-screen TUI owns the pane (between enter edge + exit edge). */
  tuiRunning: boolean;
}

export interface TuiCursorInput {
  /** What this chunk's takeover signal is (if any). */
  enterMode: TuiEnterMode;
  /** Does the chunk carry an alt-screen leave (`?1049l`) — the TUI exited. */
  altExit: boolean;
  /** Did the OSC 133 stream produce a `commandEnd`/`promptStart` during this
   *  chunk's parse — i.e. the bare shell's prompt function ran, meaning a
   *  command/TUI just finished and the shell reclaimed the pane. Pre-computed
   *  by TerminalPane via the existing `parseOscPayload`-based OSC handler (it
   *  sees complete sequences even when they're split across pty chunks, which
   *  a raw `chunk.includes` here could miss). */
  oscExit: boolean;
}

export interface TuiCursorActions {
  /** Fire markTuiEntered — the chip strip should auto-hide. */
  markEntered: boolean;
  /** Fire markTuiExited — the chip strip reappears. */
  markExited: boolean;
  /** Defensive backstop on the falling edge: set `term.options.cursorBlink = true`
   *  AND (handled in TerminalPane) write `\u001b[?25h` so the bare shell prompt
   *  keeps its M2 alive-cue blink. The strip (`stripCursorVisibilityModes`,
   *  applied while tuiRunning) ENDS same edge — so codex's post-exit bytes
   *  reach xterm unstripped and any final `?25h` codex emits on shutdown is
   *  honored. */
  restoreBlink: boolean;
  /** Rising-edge signal: a TUI just started owning the pane. Under the OLD
   *  design the consumer flipped `term.options.cursorBlink = false` here; that
   *  suppressed the idle alive-cue ENTIRELY, and the strip in (1) was already
   *  the streaming no-strobe lever — so TerminalPane now IGNORES this signal.
   *  Kept in the actions contract so the latch's rising-edge transition stays
   *  observable + unit-testable (the test asserts the latch FIRES it even
   *  though the consumer no longer writes the option). See the file header
   *  + TerminalPane's `(3)` block for the empirical A/B that retired the
   *  rising-edge `cursorBlink = false` flip. */
  suppressBlink: boolean;
}

/** Detect a takeover signal inside a raw pty chunk. `alt` wins over `sync`
 *  when both happen to land in the same chunk (an alt-screen TUI that also
 *  enables synced output entered alt screen first). */
export function detectTuiEnter(chunk: string): TuiEnterMode {
  if (chunk.includes(ALT_SCREEN_ENTER)) return "alt";
  if (chunk.includes(SYNC_OPEN)) return "sync";
  return null;
}

/** Does the chunk carry an alt-screen leave. */
export function detectTuiAltExit(chunk: string): boolean {
  return chunk.includes(ALT_SCREEN_LEAVE);
}

/** Advance the latch by one chunk. PURE: given the state before this chunk and
 *  the chunk-derived inputs, returns the state after and the side effects the
 *  TerminalPane caller should apply (chip-strip markers to fire + which
 *  cursorBlink option transitions to write). Edge discipline:
 *  - ENTER fires only on the rising edge (`!tuiRunning && enterMode`) — a tight
 *    burst of `?1049h`/`?2026h` frames doesn't re-fire markEntered.
 *  - EXIT fires only when the LATCH WAS ALREADY RUNNING at the start of this
 *    chunk (`prev.tuiRunning`) — so the rare chunk that happens to deliver both
 *    the previous shell prompt's `133;D`/`133;A` and codex's `?2026h` launch
 *    can't false-fire an exit on the very frame we're entering. (Same-chunk
 *    enter-then-exit for a TUI doesn't exist in practice — TUIs run for
 *    seconds — but the gate makes the invariant airtight anyway.) */
export function applyTuiCursorStep(
  prev: TuiCursorState,
  input: TuiCursorInput,
): { next: TuiCursorState; actions: TuiCursorActions } {
  const wasRunning = prev.tuiRunning;
  let tuiRunning = prev.tuiRunning;

  let markEntered = false;
  if (!tuiRunning && input.enterMode !== null) {
    tuiRunning = true;
    markEntered = true;
  }

  let markExited = false;
  const exiting = wasRunning && (input.altExit || input.oscExit);
  if (exiting) {
    tuiRunning = false;
    markExited = true;
  }

  // Blink transitions are edge-driven off the latch: suppress on the rising
  // (not-running → running) edge, restore on the falling (running → not)
  // edge. Steady-state chunks (still running, or still idle) emit neither so
  // the TerminalPane caller writes cursorBlink only on real transitions.
  const suppressBlink = markEntered;
  const restoreBlink = markExited;

  return {
    next: { tuiRunning },
    actions: { markEntered, markExited, restoreBlink, suppressBlink },
  };
}

export type SyncFlushReason = "close" | "depth" | "length" | "timeout";

export interface SyncBatcher {
  /** Depth of open `?2026h` frames: incremented on `?2026h`, decremented on
   *  `?2026l`. Depth tracks nesting; a frame is only flushed when depth
   *  returns to 0. Kept on the batcher (NOT scannable per-chunk) so an escape
   *  split across `onData` chunk boundaries is handled by xterm's own parser
   *  inside `terminal.write`, not this regex wrapper. */
  depth: number;
  /** Accumulated frame body waiting for a `?2026l`. */
  pending: string;
  /** The most recent CUP codex emitted OUTSIDE any sync frame, scanned from
   *  passthrough slices by `scanOutsideCups`. Empirically (per the live probe
   *  in `__codex_probe.log` — 33 of 36 outside-sync shows pair with CUP 21;3)
   *  this snaps to codex's prompt-input cell after the first cycle. NULL
   *  until the first outside-sync CUP arrives. TerminalPane reads this AFTER
   *  each inside-TUI sync-close to pin the cursor via a programmatic
   *  `\u001b[<row>;<col>H\u001b[?25h` write so the blinker stays VISIBLE at
   *  codex's stable prompt cell while it streams (no hopping to body-lastCup:
   *  footer row 23;52 / response row 18;col). CUPs INSIDE sync frames (body
   *  paint) are NEVER scanned into this — only the depth=0 passthrough path
   *  of `batchSyncFrames` runs `scanOutsideCups` — so the footer/response
   *  body-lastCups never pollute the anchor. */
  lastOutsideCup: { row: number; col: number } | null;
  /** The most recent CUP the producer painted INSIDE a `?2026h`…`?2026l`
   *  sync frame — codex's body paint (the response row advancing, the footer
   *  workspace row at 23;52, the working banner). Scanned by
   *  `scanInsideCups` as `batchSyncFrames` accumulates body bytes into
   *  `pending` — kept DISTINCT from `lastOutsideCup` so body CUPs never
   *  pollute the outside anchor. Used by TerminalPane's (3b) discriminator
   *  to disambiguate a STREAMING cycle (fresh outside-sync CUP arrives,
   *  single-chunk: anchor to the fresh outside cell) from a STREAMING-SPLIT
   *  cycle (body painted this chunk, outside-pulse lands in the NEXT chunk:
   *  trust the stable stale outside anchor) from a TYPING cycle (body CUP at
   *  the prompt-input row: cursor should advance to body-lastCup and stay —
   *  the user's "blinker on the just-typed H" complaint — NOT snap back to
   *  the stale outside anchor). NULL until the first inside-sync CUP arrives. */
  lastBodyCup: { row: number; col: number } | null;
  /** Per-call freshness flags — reset to `false` at the start of EVERY
   *  `batchSyncFrames` call, set `true` ONLY by the scan helpers when they
   *  observe a CUP during that call. They let the (3b) discriminator tell a
   *  FRESH outside anchor (streaming cycle: outside-sync CUP arrived this
   *  chunk) from a STALE one (held over from a previous chunk — typing cycle,
   *  where the producer emits no outside-sync re-anchor). Consumers read
   *  the SAME facts off `SyncBatchResult` (`outsideCupFresh`, `chunkHadCup`)
   *  rather than reaching for these transients directly — they're on the
   *  batcher only so `scanOutsideCups`/`scanInsideCups` can mutate them
   *  through their passed-in batcher reference. */
  outsideCupFresh: boolean;
  bodyCupFresh: boolean;
}

export const SYNC_FLUSH_TIMEOUT_MS = 1000;
/** Hard cap on buffer length before an exhaustion flush fires, so a runaway
 *  producer (or a `?2026h` with no matching close) can never grow the buffer
 *  without bound. 1 MiB is far above any real codex frame. */
export const SYNC_FLUSH_MAX_LENGTH = 1 << 20;

export interface SyncBatchResult {
  /** Chunks the caller should hand to `terminal.write`, IN ORDER. Emits are
   *  either pre-frame passthrough (depth 0, no open frame) or a single
   *  full-frame flush on `?2026l`. */
  emits: string[];
  /** Whether the batcher is sitting on an open frame after this push. */
  hasOpenFrame: boolean;
  /** If the whole buffer or a mid-frame chunk was force-flushed for safety,
   *  the reason; otherwise `null`. Callers may log it. */
  forceFlushed: SyncFlushReason | null;
  /** `true` when a CUP was scanned OUTSIDE any sync frame DURING this call —
   *  i.e. codex's/opencode's per-close outside-sync re-anchor pulse arrived
   *  in THIS chunk, so `batcher.lastOutsideCup` is fresh. TerminalPane's (3b)
   *  reads `true` and pins the cursor at the fresh anchor cell (the
   *  streaming-cycle path); `false` means the outside anchor is STALE (held
   *  over from a previous chunk — the typing cycle, which emits no outside
   *  re-anchor), so (3b) falls through to the chunkHadCup / body-anchor
   *  heuristic or the no-CUP text-echo advance. Resets to false at the start
   *  of every `batchSyncFrames` call. */
  outsideCupFresh: boolean;
  /** `true` when ANY CUP at all was observed during this call — inside a
   *  sync frame (body paint, bodyCupFresh) OR outside one (passthrough,
   *  outsideCupFresh). Drives the (3b) discriminator's middle branch (a
   *  typing cycle whose body CUP should advance the cursor naturally, OR a
   *  streaming-split chunk N whose body painted a row the outside anchor
   *  can't — they're distinguished by a row-match heuristic against
   *  `lastBodyCup` vs `lastOutsideCup`); `false` together with a
   *  `outsideCupFresh:false` falls through to the no-CUP pure-text-echo
   *  branch (opencode typing — don't move the cursor, let xterm's own write
   *  advance it). */
  chunkHadCup: boolean;
}

/** Advance the Mode-2026 batcher by one pty chunk. PURE modulo the mutable
 *  batcher object it's given (its `depth` + `pending`); no I/O. Algorithm:
 *  - with no open frame, write everything up to the first `?2026h` directly,
 *    then OPEN a frame at that point;
 *  - with an open frame, append to `pending` and scan for the matching
 *    `?2026l`. Output stays embargoed until depth returns to 0.
 *  Safety valves on the open-frame path:
 *    - LENGTH: a frame whose body exceeds SYNC_FLUSH_MAX_LENGTH is exhausted
 *      early (a pathological producer never stalls the pane);
 *    - DEPTH: nested `?2026h` within an open frame increments depth; a
 *      matching `?2026l` decrements. Frame flushes only at depth 0.
 *  The two safety valves + the timeout fire handle in TerminalPane together
 *  guarantee a TUI can never wedge its pane even if it emits `?2026h` with no
 *  close, nests insanely, or stalls mid-stream. */
export function batchSyncFrames(
  batcher: SyncBatcher,
  chunk: string,
): SyncBatchResult {
  const emits: string[] = [];
  let forceFlushed: SyncFlushReason | null = null;

  // Reset the per-call freshness flags BEFORE any scan runs. The (3b)
  // discriminator in TerminalPane reads these off SyncBatchResult to tell a
  // fresh outside anchor (arrived THIS chunk — codex/opencode's per-close
  // re-anchor pulse) from one held over from a previous chunk (a typing
  // cycle, which emits no outside-sync re-anchor, so the stale outside cell
  // is still pinned to the pre-typing prompt start). A stale `true` latched
  // across chunks would misclassify every typing cycle as a streaming
  // re-anchor and snap the cursor back onto the just-typed char — the exact
  // "blinker on H" symptom this discriminator was built to fix.
  batcher.outsideCupFresh = false;
  batcher.bodyCupFresh = false;

  // Safety valve #3 (LENGTH) — only meaningful with an open frame.
  if (
    batcher.depth > 0 &&
    batcher.pending.length + chunk.length > SYNC_FLUSH_MAX_LENGTH
  ) {
    forceFlushed = "length";
    const combined = batcher.pending + chunk;
    batcher.depth = 0;
    batcher.pending = "";
    emits.push(combined);
    // Best-effort: scan the new chunk for inside-sync body CUPs even on the
    // length overflow escape hatch, so the (3b) heuristic isn't flying blind
    // on a pathological 1 MiB body. (batcher.pending's body CUPs were
    // already scanned when they were appended in prior calls.)
    scanInsideCups(chunk, batcher);
    // The whole buffer exhausted; return after emitting. The new chunk's bytes
    // have all been shipped (no `?2026h` left open — we reset depth).
    // If `chunk` itself reopened a frame at its tail (unlikely after a 1 MiB
    // flush), the next push handles it cleanly.
    return {
      emits,
      hasOpenFrame: false,
      forceFlushed,
      outsideCupFresh: batcher.outsideCupFresh,
      chunkHadCup: batcher.outsideCupFresh || batcher.bodyCupFresh,
    };
  }

  let rest = chunk;

  while (rest.length > 0) {
    if (batcher.depth === 0) {
      const openIdx = rest.indexOf(SYNC_OPEN);
      if (openIdx === -1) {
        // No frame opener in the remainder — passthrough in full. Scan for
        // outside-sync CUPs (codex's prompt-input anchor pulse — see
        // SyncBatcher.lastOutsideCup + the `__codex_probe.log` dig) so
        // TerminalPane can re-anchor the cursor at that cell on the next
        // sync close.
        scanOutsideCups(rest, batcher);
        emits.push(rest);
        rest = "";
        break;
      }
      // Passthrough up to the opener, then open the frame. The opener itself
      // is preserved in the flush (lossless batching: the eventual emit is
      // byte-identical to what would've been written un-batched, just
      // coalesced into one `term.write` so its intermediates don't render as
      // partial states).
      if (openIdx > 0) {
        const prefix = rest.slice(0, openIdx);
        scanOutsideCups(prefix, batcher);
        emits.push(prefix);
      }
      batcher.pending += SYNC_OPEN;
      rest = rest.slice(openIdx + SYNC_OPEN.length);
      batcher.depth = 1;
      continue;
    }

    // Open frame: scan the body for the matching close (or a nested opener).
    const closeIdx = rest.indexOf(SYNC_CLOSE);
    const nestedIdx = rest.indexOf(SYNC_OPEN);

    if (closeIdx === -1 && nestedIdx === -1) {
      // Whole remainder belongs inside the open frame; embargo it + scan
      // its body CUPs into `lastBodyCup` (the typing-cycle heuristic in
      // TerminalPane's (3b) compares lastBodyCup.row vs lastOutsideCup.row
      // to decide between body-advance and stale-outside-anchor).
      scanInsideCups(rest, batcher);
      batcher.pending += rest;
      rest = "";
      break;
    }

    // Whichever comes first: a nested `?2026h` (depth++) or a close `?2026l`
    // (depth--). Same-index can't happen (different final bytes); the tie
    // break picks the earliest so order is preserved.
    const takeNested =
      nestedIdx !== -1 && (closeIdx === -1 || nestedIdx < closeIdx);

    // Spacer depth at >= 0 so a stray `?2026l` with no opener on this batcher
    // (a producer that emitted close-only) can't underflow the depth.
    if (takeNested) {
      const nestedBody = rest.slice(0, nestedIdx);
      scanInsideCups(nestedBody, batcher);
      batcher.pending += nestedBody + SYNC_OPEN;
      rest = rest.slice(nestedIdx + SYNC_OPEN.length);
      batcher.depth += 1;
      continue;
    }

    // close before nested (or no nested). The body bytes just before the
    // close delimiter are INSIDE-sync CUPs — scan them (single-chunk frames
    // AND the tail of the last body slice of a split frame land here).
    const closeBody = rest.slice(0, closeIdx);
    scanInsideCups(closeBody, batcher);
    batcher.pending += closeBody + SYNC_CLOSE;
    rest = rest.slice(closeIdx + SYNC_CLOSE.length);
    if (batcher.depth > 0) batcher.depth -= 1;
    if (batcher.depth === 0) {
      // Frame closed: flush the embargoed body (delimiters preserved).
      emits.push(batcher.pending);
      batcher.pending = "";
    }
  }

  return {
    emits,
    hasOpenFrame: batcher.depth > 0,
    forceFlushed,
    outsideCupFresh: batcher.outsideCupFresh,
    chunkHadCup: batcher.outsideCupFresh || batcher.bodyCupFresh,
  };
}

/** Force-flush whatever the batcher is embargoing, used by TerminalPane's
 *  TIMEOUT safety valve (fires ~SYNC_FLUSH_TIMEOUT_MS after a frame opens
 *  without seeing a close). Resets depth/pending and returns the body; a
 *  sender that vill never close its `?2026h` still gets its bytes on screen,
 *  just un-batched (worst case: the original flicker returns, never a stall). */
export function flushSyncBatcher(batcher: SyncBatcher): {
  flushed: string | null;
} {
  if (batcher.depth === 0 && batcher.pending === "") return { flushed: null };
  const body = batcher.pending;
  batcher.depth = 0;
  batcher.pending = "";
  return { flushed: body };
}
