// syncBatcher — the three pure levers TerminalPane uses to stop codex's
// "blinking the hell out" during its working phase:
//   * Cursor-visibility strip — codex emits each `?2026h`…`?2026l` frame as
//     `?2026h` → `?25l` (hide) → body → `?25h` (show) → `ESC[0 q` →
//     `?2026l`. Pairs INSIDE a sync frame collapse (xterm v6 honors Mode 2026
//     natively — `CoreService.decPrivateModes.synchronizedOutput` diverts
//     `_renderRows` into `_syncOutputHandler.bufferRows` until `?2026l`, so
//     by then `?25h` has re-shown). But ~1/3 of codex's `?25h`/`?25l` land
//     OUTSIDE sync frames where xterm renders IMMEDIATELY — each stray `?25l`
//     paints cursor-HIDDEN, the next `?25h` paints it VISIBLE, at frame rate
//     ⇒ the strobe the user calls "blinking the hell out". Bundle:
//     `?25l`/`?25h` → `coreService.isCursorHidden = !0/!1`; `createRow`
//     gates the cursor cell on `!isCursorHidden` LIVE per render. The fix:
//     `stripCursorVisibilityModes` removes `?25h`/`?25l`/`?12h`/`?12l` from
//     a chunk so `isCursorHidden` stays at its initial `false` — xterm then
//     paints a STEADY inverse `xterm-cursor-block` at each flush.
//   * Mode-2026 (synchronized output) frame coalescer — `batchSyncFrames`.
//     xterm v6 honors Mode 2026 natively (above), so this is a defensive
//     COALESCER that keeps one `?2026h`…`?2026l` body a single `terminal.write`
//     even if ConPTY/node-pty chops it across onData events (so a partial
//     frame at a chunk boundary can't foul the OSC 133 / latch flows).
//   * TUI-latch state machine — chip-strip auto-hide + the blink option-flip
//     backstops, now catching codex (inline, `?2026h`) in addition to
//     opencode/claude (alt-screen, `?1049h`), exiting on `?1049l` or a shell
//     prompt resuming (OSC 133 commandEnd/promptStart).
//
// Pure (no xterm, no jsdom): exercises the algorithms directly.

import { describe, expect, it } from "vitest";
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_LEAVE,
  DECTCEM_HIDE,
  DECTCEM_SHOW,
  DECSDM_OFF,
  DECSDM_ON,
  SYNC_OPEN,
  SYNC_CLOSE,
  applyTuiCursorStep,
  batchSyncFrames,
  detectTuiAltExit,
  detectTuiEnter,
  flushSyncBatcher,
  stripCursorVisibilityModes,
  SYNC_FLUSH_MAX_LENGTH,
  type SyncBatcher,
} from "../src/terminals/syncBatcher";

function fresh(): SyncBatcher {
  return {
    depth: 0,
    pending: "",
    lastOutsideCup: null,
    lastBodyCup: null,
    outsideCupFresh: false,
    bodyCupFresh: false,
  };
}

// ---------------------------------------------------------------------------
// detectTuiEnter — takeover signal classification
// ---------------------------------------------------------------------------

describe("detectTuiEnter", () => {
  it("returns null for a bare-shell chunk (no takeover escape)", () => {
    expect(detectTuiEnter("ps C:\\Users\\W> ")).toBeNull();
    expect(detectTuiEnter("\x1b]0;title\x07hello\r\n")).toBeNull();
  });

  it("returns 'alt' for an alt-screen enter (opencode/claude)", () => {
    expect(detectTuiEnter("\x1b[?1049h")).toBe("alt");
    expect(detectTuiEnter("x\x1b[?1049hy")).toBe("alt");
  });

  it("returns 'sync' for a Mode-2026 opener (codex's inline signal)", () => {
    expect(detectTuiEnter("\x1b[?2026h")).toBe("sync");
    expect(detectTuiEnter("\x1b[?9001h\x1b[?1004h\x1b[?2026h")).toBe("sync");
  });

  it("prefers 'alt' when both ?1049h and ?2026h land in one chunk", () => {
    expect(
      detectTuiEnter("\x1b[?1049h\x1b[?2026h"),
    ).toBe("alt");
  });

  it("ignores leave escapes on enter classification", () => {
    expect(detectTuiEnter("\x1b[?1049l")).toBeNull();
    expect(detectTuiEnter("\x1b[?2026l")).toBeNull();
  });
});

describe("detectTuiAltExit", () => {
  it("detects an alt-screen leave", () => {
    expect(detectTuiAltExit("\x1b[?1049l")).toBe(true);
    expect(detectTuiAltExit("aa\x1b[?1049lbb")).toBe(true);
  });
  it("misses only the close half of a split ?1049l", () => {
    // split-across-chunks risk: each half is NOT the full 7-byte sequence so a
    // single includes() check can't see it — the NEXT chunk's includes() also
    // can't. That's why EXIT via the OSC handler (which xterm parses whole) is
    // the canonical path; alt-leave is a fast early mirror for alt-screen TUIs.
    expect(detectTuiAltExit("\x1b[?1049")).toBe(false);
    expect(detectTuiAltExit("l")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyTuiCursorStep — latch state machine
// ---------------------------------------------------------------------------

describe("applyTuiCursorStep", () => {
  it("latches on an alt enter and fires markEntered + suppressBlink", () => {
    const { next, actions } = applyTuiCursorStep(
      { tuiRunning: false },
      { enterMode: "alt", altExit: false, oscExit: false },
    );
    expect(next.tuiRunning).toBe(true);
    expect(actions).toEqual({
      markEntered: true,
      markExited: false,
      restoreBlink: false,
      suppressBlink: true,
    });
  });

  it("latches on a sync enter (codex) the same way", () => {
    const { next, actions } = applyTuiCursorStep(
      { tuiRunning: false },
      { enterMode: "sync", altExit: false, oscExit: false },
    );
    expect(next.tuiRunning).toBe(true);
    expect(actions.markEntered).toBe(true);
    expect(actions.suppressBlink).toBe(true);
  });

  it("does not re-fire markEntered on a burst of repeats (rising edge only)", () => {
    const first = applyTuiCursorStep(
      { tuiRunning: false },
      { enterMode: "sync", altExit: false, oscExit: false },
    );
    const second = applyTuiCursorStep(
      first.next,
      { enterMode: "sync", altExit: false, oscExit: false },
    );
    expect(second.next.tuiRunning).toBe(true);
    expect(second.actions.markEntered).toBe(false);
    expect(second.actions.suppressBlink).toBe(false); // no transition
  });

  it("exits on an alt-screen leave and fires markExited + restoreBlink", () => {
    const { next, actions } = applyTuiCursorStep(
      { tuiRunning: true },
      { enterMode: null, altExit: true, oscExit: false },
    );
    expect(next.tuiRunning).toBe(false);
    expect(actions).toEqual({
      markEntered: false,
      markExited: true,
      restoreBlink: true,
      suppressBlink: false,
    });
  });

  it("exits on an OSC prompt resuming (codex's inline path)", () => {
    const { next, actions } = applyTuiCursorStep(
      { tuiRunning: true },
      { enterMode: null, altExit: false, oscExit: true },
    );
    expect(next.tuiRunning).toBe(false);
    expect(actions.markExited).toBe(true);
    expect(actions.restoreBlink).toBe(true);
  });

  it("does NOT exit on the very chunk it entered (wasRunning gate)", () => {
    // The rare chunk carrying the previous prompt's 133;D/133;A AND codex's
    // launch ?2026h: enter fires (markEntered) but exit is suppressed because
    // the latch wasn't running at the START of the chunk.
    const { next, actions } = applyTuiCursorStep(
      { tuiRunning: false },
      { enterMode: "sync", altExit: false, oscExit: true },
    );
    expect(next.tuiRunning).toBe(true);
    expect(actions.markEntered).toBe(true);
    expect(actions.markExited).toBe(false);
    expect(actions.restoreBlink).toBe(false);
  });

  it("steady-state idle chunk emits no actions", () => {
    const { next, actions } = applyTuiCursorStep(
      { tuiRunning: false },
      { enterMode: null, altExit: false, oscExit: false },
    );
    expect(next.tuiRunning).toBe(false);
    expect(actions).toEqual({
      markEntered: false,
      markExited: false,
      restoreBlink: false,
      suppressBlink: false,
    });
  });

  it("steady-state running chunk emits no actions", () => {
    const { next, actions } = applyTuiCursorStep(
      { tuiRunning: true },
      { enterMode: null, altExit: false, oscExit: false },
    );
    expect(next.tuiRunning).toBe(true);
    expect(actions).toEqual({
      markEntered: false,
      markExited: false,
      restoreBlink: false,
      suppressBlink: false,
    });
  });

  it("ignores a oscExit when not running (bare-shell prompt is a no-op)", () => {
    const { next, actions } = applyTuiCursorStep(
      { tuiRunning: false },
      { enterMode: null, altExit: false, oscExit: true },
    );
    expect(next.tuiRunning).toBe(false);
    expect(actions.markExited).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stripCursorVisibilityModes — DECTCEM + DECSDM strip (the actual no-blink lever)
// ---------------------------------------------------------------------------

describe("stripCursorVisibilityModes", () => {
  it("is a no-op for a bare-shell chunk that carries no cursor-visibility modes", () => {
    expect(stripCursorVisibilityModes("ps C:\\Users\\W> ")).toBe("ps C:\\Users\\W> ");
    // Plain prompt text + OSC 0 (window title) + OSC 8 (hyperlink) survive.
    expect(stripCursorVisibilityModes("\u001b]0;title\u0007plain text\r\n")).toBe(
      "\u001b]0;title\u0007plain text\r\n",
    );
  });

  it("strips codex's per-frame `?2026h\u001b[?25l…\u001b[?25h\u001b[0 q\u001b[?2026l` down to the sync open + DECSCUSR + close", () => {
    // Frame body trimmed to a representative slice (codex actually emits a
    // full-screen CUP rush + content; the structure is what matters). The
    // result MUST keep `?2026h`, `ESC[0 q`, `?2026l` (those aren't the strip
    // targets) and lose both `?25l` and `?25h`.
    const chunk = `${SYNC_OPEN}${DECTCEM_HIDE}\u001b[2m body \u001b[22m${DECTCEM_SHOW}\u001b[0 q${SYNC_CLOSE}`;
    const stripped = stripCursorVisibilityModes(chunk);
    expect(stripped).toContain(`\u001b[0 q`);
    expect(stripped).toContain(SYNC_OPEN);
    expect(stripped).toContain(SYNC_CLOSE);
    expect(stripped).not.toContain(DECTCEM_HIDE);
    expect(stripped).not.toContain(DECTCEM_SHOW);
    // Body content survives verbatim.
    expect(stripped).toContain(`\u001b[2m body \u001b[22m`);
  });

  it("strips OUTSIDE-sync-frame flashes — the actual culprit from the live capture", () => {
    // Per `.codex-capture2/raw.bin`: between two sync frames codex emits
    // `?25l` (hide) immediately on frame close, then `?25h` (show) later
    // outside any sync window — xterm flushes those toggles IMMEDIATELY
    // → the visible strobe. With the strip, both outside-frame toggles
    // disappear; the passthrough body (`text`, `nextsync`) is unchanged.
    const chunk = `${DECTCEM_HIDE}text\u001b[?25h${SYNC_OPEN}nextsync`;
    const stripped = stripCursorVisibilityModes(chunk);
    expect(stripped).not.toContain(DECTCEM_HIDE);
    expect(stripped).not.toContain(DECTCEM_SHOW);
    expect(stripped).toBe(`text${SYNC_OPEN}nextsync`);
  });

  it("strips both `?12h` (DECSDM on) and `?12l` (off) — codex emits zero today, defense for other TUIs", () => {
    // `?12h` would write rawOptions.cursorBlink=true through the OptionsProxy
    // setter and re-arm the CSS @keyframes via onOptionChange — strip it
    // pre-parser so the option flip never sees the bytes.
    const chunk = `before${DECSDM_ON}after${DECSDM_OFF}tail`;
    expect(stripCursorVisibilityModes(chunk)).toBe("beforeaftertail");
  });

  it("strips multiple toggles in one chunk", () => {
    // A burst frame whose body itself hides/shows once inside the body and
    // once after the close (e.g. codex's inter-frame hide-then-show on the
    // very first chunk after a sync flush).
    const chunk =
      `${SYNC_OPEN}b1${DECTCEM_HIDE}b2${DECTCEM_SHOW}b3${SYNC_CLOSE}${DECTCEM_HIDE}${DECTCEM_SHOW}tail`;
    const stripped = stripCursorVisibilityModes(chunk);
    expect(stripped).toBe(`${SYNC_OPEN}b1b2b3${SYNC_CLOSE}tail`);
  });

  it("does NOT strip `?25h` text without the ESC lead-in", () => {
    // A weird prompt that literally contains the chars `[?25h` as text MUST
    // survive — the regex is anchored on `\x1b\[` (ESC + [).
    expect(stripCursorVisibilityModes("echo [?25h not stripped")).toBe(
      "echo [?25h not stripped",
    );
  });

  it("does NOT strip private modes with a parameter tail (e.g. `?25;1h`)", () => {
    // Codex's actual capture emits bare `?25h`/`?25l` without parameters; a
    // hypothetical `?25;1h` ANSI form survives the strip (xterm v6 doesn't
    // accept it as DECTCEM — it's a different `*SetMode` group). Just want a
    // narrow regex that hits codex's actual escape shape.
    const weird = "\u001b[?25;1h$\u001b[?25;1l";
    expect(stripCursorVisibilityModes(weird)).toBe(weird);
  });

  it("preserves alt-screen enter/leave and other private modes cursor-unrelated", () => {
    // `?1049h`/`?1049l` are TUI alt-screen takeover/leave — must NOT be
    // stripped (they drive the latch detection!). The strip only removes the
    // cursor-visibility/blink pair.
    const chunk = `${ALT_SCREEN_ENTER}${DECTCEM_HIDE}body${DECTCEM_SHOW}${ALT_SCREEN_LEAVE}`;
    expect(stripCursorVisibilityModes(chunk)).toBe(
      `${ALT_SCREEN_ENTER}body${ALT_SCREEN_LEAVE}`,
    );
  });

  it("empty input is a no-op", () => {
    expect(stripCursorVisibilityModes("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// batchSyncFrames — Mode-2026 collapse
// ---------------------------------------------------------------------------

describe("batchSyncFrames", () => {
  it("passes non-frame chunks straight through when no frame is open", () => {
    const b = fresh();
    const out = batchSyncFrames(b, "hello world");
    expect(out.emits).toEqual(["hello world"]);
    expect(out.hasOpenFrame).toBe(false);
    expect(b.depth).toBe(0);
    expect(b.pending).toBe("");
  });

  it("passes a whole sequence of non-frame chunks through unchanged", () => {
    const b = fresh();
    const a = batchSyncFrames(b, "abc");
    const c = batchSyncFrames(b, "def");
    expect(a.emits).toEqual(["abc"]);
    expect(c.emits).toEqual(["def"]);
  });

  it("embargoes a frame's body until the close, then flushes as one", () => {
    const b = fresh();
    // open the frame
    expect(batchSyncFrames(b, `\x1b[?1049h${SYNC_OPEN}`).hasOpenFrame).toBe(true);
    // body streamed in pieces WITH the toggle-flash bytes inside it
    const mid = batchSyncFrames(
      b,
      `\x1b[?25l\x1b[H\x1b[H\x1b[?25hspinner1`,
    );
    expect(mid.emits).toEqual([]); // NOTHING ships mid-frame — intermediates die
    const closing = batchSyncFrames(b, `frame-end${SYNC_CLOSE}\x1b[?25h`);
    // The flush is the WHOLE frame body (open-escape through close-escape),
    // and the post-close bytes ride as their own emit.
    expect(closing.emits).toHaveLength(2);
    // noUncheckedIndexedAccess makes array destructure possibly-undefined, so
    // assert via element indexing + a length guard above.
    expect(closing.emits[0]).toBe(
      `\x1b[?2026h\x1b[?25l\x1b[H\x1b[H\x1b[?25hspinner1frame-end${SYNC_CLOSE}`,
    );
    expect(closing.emits[1]).toBe("\x1b[?25h");
    expect(b.depth).toBe(0);
    expect(b.pending).toBe("");
  });

  it("collapses a one-shot frame (open+body+close in one chunk) to a single emit", () => {
    const b = fresh();
    const out = batchSyncFrames(b, `pre${SYNC_OPEN}body${SYNC_CLOSE}post`);
    expect(out.emits).toEqual([`pre`, `${SYNC_OPEN}body${SYNC_CLOSE}`, `post`]);
    expect(out.hasOpenFrame).toBe(false);
  });

  it("does not emit anything between an open and its split-across-chunks close", () => {
    // The frame's body bytes are split across onData chunks. Each chunk is
    // embargoed; the flush happens the moment the close lands.
    const b = fresh();
    expect(batchSyncFrames(b, `${SYNC_OPEN}par`).emits).toEqual([]);
    expect(batchSyncFrames(b, `t1`).emits).toEqual([]);
    expect(batchSyncFrames(b, `t2`).emits).toEqual([]);
    const end = batchSyncFrames(b, `${SYNC_CLOSE}x`);
    expect(end.emits).toEqual([`${SYNC_OPEN}part1t2${SYNC_CLOSE}`, `x`]);
  });

  it("handles multiple consecutive frames in one chunk", () => {
    const b = fresh();
    const out = batchSyncFrames(
      b,
      `a${SYNC_OPEN}b${SYNC_CLOSE}c${SYNC_OPEN}d${SYNC_CLOSE}e`,
    );
    expect(out.emits).toEqual([
      `a`,
      `${SYNC_OPEN}b${SYNC_CLOSE}`,
      `c`,
      `${SYNC_OPEN}d${SYNC_CLOSE}`,
      `e`,
    ]);
  });

  it("handles nested ?2026h (depth > 1): flush only when depth back to 0", () => {
    const b = fresh();
    expect(batchSyncFrames(b, `${SYNC_OPEN}outer${SYNC_OPEN}inner`).emits).toEqual([]);
    expect(b.depth).toBe(2);
    expect(batchSyncFrames(b, `${SYNC_CLOSE}`).emits).toEqual([]); // depth 1
    expect(b.depth).toBe(1);
    const end = batchSyncFrames(b, `outer-end${SYNC_CLOSE}tail`);
    expect(end.emits).toEqual([
      `${SYNC_OPEN}outer${SYNC_OPEN}inner${SYNC_CLOSE}outer-end${SYNC_CLOSE}`,
      `tail`,
    ]);
    expect(b.depth).toBe(0);
  });

  it("forces a LENGTH exhaustion flush rather than blow the 1 MiB cap", () => {
    const b = fresh();
    batchSyncFrames(b, SYNC_OPEN);
    const big = "x".repeat(SYNC_FLUSH_MAX_LENGTH + 8);
    const out = batchSyncFrames(b, big);
    expect(out.forceFlushed).toBe("length");
    expect(out.hasOpenFrame).toBe(false);
    expect(b.depth).toBe(0);
    expect(b.pending).toBe("");
    expect(out.emits).toHaveLength(1);
    // The whole open-frame buffer (the `?2026h` opener marker carried by
    // depth, plus the big body) ships un-batched rather than growing.
    expect(out.emits[0]).toContain(big);
  });

  it("flushSyncBatcher empties an open frame and returns its body (timeout valve)", () => {
    const b = fresh();
    batchSyncFrames(b, `${SYNC_OPEN}stray-body`);
    const { flushed } = flushSyncBatcher(b);
    expect(flushed).toBe(`${SYNC_OPEN}stray-body`);
    expect(b.depth).toBe(0);
    expect(b.pending).toBe("");
  });

  it("flushSyncBatcher is a no-op when no frame is open", () => {
    const b = fresh();
    expect(flushSyncBatcher(b).flushed).toBeNull();
  });

  it("resumes normal passthrough after a timeout flush", () => {
    const b = fresh();
    batchSyncFrames(b, `${SYNC_OPEN}stray`);
    flushSyncBatcher(b);
    const out = batchSyncFrames(b, "new-text");
    expect(out.emits).toEqual(["new-text"]);
    expect(out.hasOpenFrame).toBe(false);
  });

  it("a close whose opener never arrived (stray ?2026l) just passes through", () => {
    const b = fresh();
    const out = batchSyncFrames(b, `text${SYNC_CLOSE}more`);
    // No open frame to match: depth would underflow. Guard depth at >= 0 so a
    // stray close is treated as ordinary passthrough, not a frame boundary.
    expect(out.emits).toEqual([`text${SYNC_CLOSE}more`]);
    expect(b.depth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// batchSyncFrames — outside-sync CUP anchor harvesting (lastOutsideCup)
// ---------------------------------------------------------------------------
//
// The steady-blinker architecture (see TerminalPane `(3b)`) reserves a
// programmatic `\u001b[<row>;<col>H\u001b[?25h` write after every inside-TUI
// sync-close to anchor + re-show the cursor at codex's own prompt-input
// cell. The anchor (row, col) is tracked on the batcher by `scanOutsideCups`
// — codex emits a `CUP <row>;<col>` OUTSIDE any sync frame after EVERY close
// (per `__codex_probe.log` — 33 of 36 outside-sync shows pair with `CUP 21;3`
// during streaming, `CUP 17;3` during the early banner phase). The anchor is
// the most recent of those — saved into `batcher.lastOutsideCup`, ready for
// the post-close re-anchor write. CUPs INSIDE sync frames (body paint: footer
// workspace row 23;52, response row 18;col advancing) MUST NOT pollute the
// anchor — that's what the symptom IS.

describe("batchSyncFrames — outside-sync CUP anchor (lastOutsideCup)", () => {
  it("harvests the LAST CUP emitted OUTSIDE any sync frame to lastOutsideCup", () => {
    const b = fresh();
    // Mirror's codex's per-close re-anchor pulse:
    //   `${SYNC_OPEN} body ${SYNC_CLOSE}\x1b[21;3H`
    // The outside-sync CUP `21;3` is the prompt-input-cell anchor.
    const out = batchSyncFrames(
      b,
      `${SYNC_OPEN} body ${SYNC_CLOSE}\x1b[21;3H`,
    );
    expect(out.emits).toEqual([
      `${SYNC_OPEN} body ${SYNC_CLOSE}`,
      "\x1b[21;3H",
    ]);
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 });
  });

  it("captures the LAST CUP if multiple land in one outside-sync passthrough", () => {
    const b = fresh();
    const out = batchSyncFrames(b, `\x1b[17;3H\x1b[21;3H`);
    expect(out.emits).toEqual([`\x1b[17;3H\x1b[21;3H`]);
    // Codex's startup-phase row 17 followed by streaming-phase row 21 — the
    // most recent wins.
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 });
  });

  it("does NOT capture CUPs INSIDE a sync frame (body paint row CUPs won't pollute the anchor)", () => {
    const b = fresh();
    // codex body paint CUPs at row 18 col 4 (streaming response row
    // advancing), row 23 col 52 (footer workspace) — INSIDE the sync frame.
    // None of those should touch lastOutsideCup.
    const out = batchSyncFrames(
      b,
      `${SYNC_OPEN}\x1b[18;4Htext\x1b[23;52Hfooter${SYNC_CLOSE}\x1b[21;3H`,
    );
    expect(out.emits).toEqual([
      `${SYNC_OPEN}\x1b[18;4Htext\x1b[23;52Hfooter${SYNC_CLOSE}`,
      `\x1b[21;3H`,
    ]);
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 });
    // Repeat: a body that paints CUPs at 18;6 (advancing stream token) — must
    // NOT touch the anchor (21;3 expected to persist from previous frame's
    // outside-sync learn).
    const out2 = batchSyncFrames(
      b,
      `${SYNC_OPEN}\x1b[18;6Hnexttoken${SYNC_CLOSE}`,
    );
    expect(out2.emits).toEqual([
      `${SYNC_OPEN}\x1b[18;6Hnexttoken${SYNC_CLOSE}`,
    ]);
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 }); // unchanged
  });

  it("stays null until the first outside-sync CUP arrives — first ~80ms of a codex session", () => {
    const b = fresh();
    expect(b.lastOutsideCup).toBeNull();
    // Pure body frame, no outside-sync CUP after the close.
    batchSyncFrames(b, `${SYNC_OPEN}body${SYNC_CLOSE}`);
    expect(b.lastOutsideCup).toBeNull();
    // ...and after a passthrough chunk with no CUP either.
    batchSyncFrames(b, "idle text");
    expect(b.lastOutsideCup).toBeNull();
  });

  it("rejects row 0 / col 0 — invalid CUP coordinates never anchor the cursor", () => {
    const b = fresh();
    // `CUP 0;0` is invalid (xterm doesn't honor it). codex never emits it,
    // but defense — never anchor to an off-by-zero cell.
    const out = batchSyncFrames(b, `\x1b[0;0H`);
    expect(out.emits).toEqual([`\x1b[0;0H`]);
    expect(b.lastOutsideCup).toBeNull();
    // And a mix of invalid + valid → the valid one wins.
    batchSyncFrames(b, `\x1b[0;0H\x1b[21;3H`);
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 });
  });

  it("captures anchors between sync frames in codex's full multi-frame cycle (startup → streaming)", () => {
    // Codex's cycle: 1st frame closes + CUP 17;3 (startup-phase prompt
    // input), 2nd frame closes + CUP 21;3 (streaming-phase prompt input has
    // scrolled down by the now-visible response area).
    const b = fresh();
    const out = batchSyncFrames(
      b,
      `${SYNC_OPEN}b1${SYNC_CLOSE}\x1b[17;3H${SYNC_OPEN}b2${SYNC_CLOSE}\x1b[21;3H`,
    );
    expect(out.emits).toHaveLength(4);
    expect(out.emits[0]).toBe(`${SYNC_OPEN}b1${SYNC_CLOSE}`);
    expect(out.emits[1]).toBe("\x1b[17;3H");
    expect(out.emits[2]).toBe(`${SYNC_OPEN}b2${SYNC_CLOSE}`);
    expect(out.emits[3]).toBe("\x1b[21;3H");
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 });
  });

  it("does NOT break on chunks carrying other escapes that LOOK like they could contain CUPs but don't (e.g. `?25h` outside-frame, SGR colors)", () => {
    const b = fresh();
    // Realistic: after a frame close, codex emits `\x1b[?25l \x1b[21;3H
    // \x1b[?25h \x1b[?2026h` (the post-close re-anchor + next open). With
    // the strip in TerminalPane applied pre-batch, `\x1b[?25l`/`\x1b[?25h`
    // are GONE before this helper sees the chunk. Simulate the post-strip
    // shape here so this test mirrors what `batchSyncFrames` actually
    // receives inside TerminalPane.
    const out = batchSyncFrames(
      b,
      `\x1b[21;3H\x1b[?2026hnext-body\x1b[?2026l`,
    );
    expect(out.emits).toHaveLength(2);
    expect(out.emits[0]).toBe(`\x1b[21;3H`);
    expect(out.emits[1]).toBe(`\x1b[?2026hnext-body\x1b[?2026l`);
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 });
  });
});

// ---------------------------------------------------------------------------
// batchSyncFrames — lastBodyCup (inside-sync body CUP anchor) + per-call
// freshness flags (outsideCupFresh, bodyCupFresh → chunkHadCup)
// ---------------------------------------------------------------------------
//
// `lastBodyCup` tracks the LAST CUP the producer painted INSIDE a `?2026h`…
// `?2026l` sync frame — codex's body paint (the response row advancing, the
// footer workspace row at 23;52, AND during a typing cycle the CUP that re-
// positions the cursor at the cell AFTER the just-typed char). Harvested by
// `scanInsideCups` as `batchSyncFrames` accumulates body bytes into `pending`,
// kept DISTINCT from `lastOutsideCup` so body CUPs can never pollute the
// outside anchor. The two per-call freshness flags let TerminalPane's (3b)
// discriminator tell a STREAMING single-chunk cycle (fresh outside CUP) from a
// TYPING cycle (body CUP, stale outside — the user's "blinker on H" complaint)
// from a no-CUP text-echo advance (opencode typing).

describe("batchSyncFrames — lastBodyCup + freshness flags", () => {
  it("captures the LAST CUP painted INSIDE a sync frame to lastBodyCup (distinct from lastOutsideCup)", () => {
    const b = fresh();
    // codex streaming body paint at 18;4 (response row advancing), 23;52
    // (footer workspace) — INSIDE the sync frame. Then codex's per-close
    // outside-sync re-anchor at 21;3 — OUTSIDE the frame.
    const out = batchSyncFrames(
      b,
      `${SYNC_OPEN}\x1b[18;4Htext\x1b[23;52Hfooter${SYNC_CLOSE}\x1b[21;3H`,
    );
    expect(out.emits).toEqual([
      `${SYNC_OPEN}\x1b[18;4Htext\x1b[23;52Hfooter${SYNC_CLOSE}`,
      `\x1b[21;3H`,
    ]);
    expect(b.lastBodyCup).toEqual({ row: 23, col: 52 });
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 });
    // Fresh this call: an outside-sync CUP arrived (the 21;3 re-anchor).
    expect(out.outsideCupFresh).toBe(true);
    expect(out.chunkHadCup).toBe(true);
  });

  it("leaves lastBodyCup untouched by an OUTSIDE-sync CUP (the outside path scans lastOutsideCup, not lastBodyCup)", () => {
    const b = fresh();
    // First chunk seeds lastBodyCup with a body CUP at 18;4.
    batchSyncFrames(b, `${SYNC_OPEN}\x1b[18;4Hbody${SYNC_CLOSE}`);
    expect(b.lastBodyCup).toEqual({ row: 18, col: 4 });
    // Then a passthrough chunk with an outside-sync CUP only — lastBodyCup
    // must NOT move (the outside path harvests lastOutsideCup, not lastBodyCup).
    batchSyncFrames(b, `\x1b[21;3H`);
    expect(b.lastBodyCup).toEqual({ row: 18, col: 4 });
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 });
  });

  it("leaves lastOutsideCup untouched by an INSIDE-sync CUP (the body never pollutes the outside anchor — the original hop symptom)", () => {
    const b = fresh();
    // Seed lastOutsideCup = 21;3 from a streaming-pulse chunk.
    batchSyncFrames(b, `${SYNC_OPEN}b${SYNC_CLOSE}\x1b[21;3H`);
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 });
    // Then a body frame that paints 18;6 (streaming response row). The body
    // CUP must NOT touch lastOutsideCup — footer/response body-lastCups
    // contaminating the outside anchor IS the original "blinker hops onto
    // the footer" complaint the steady-blinker architecture masks.
    batchSyncFrames(b, `${SYNC_OPEN}\x1b[18;6Hnexttoken${SYNC_CLOSE}`);
    expect(b.lastBodyCup).toEqual({ row: 18, col: 6 });
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 }); // unchanged
  });

  it("sets chunkHadCup=true whenever ANY CUP lands (inside OR outside); false only when the chunk has NO CUP", () => {
    const b = fresh();
    // Pure outside-sync CUP — chunkHadCup=true, outsideCupFresh=true.
    let out = batchSyncFrames(b, `\x1b[21;3H`);
    expect(out.chunkHadCup).toBe(true);
    expect(out.outsideCupFresh).toBe(true);
    // Pure inside-sync CUP — chunkHadCup=true, outsideCupFresh=false.
    out = batchSyncFrames(b, `${SYNC_OPEN}\x1b[18;4Hbody${SYNC_CLOSE}`);
    expect(out.chunkHadCup).toBe(true);
    expect(out.outsideCupFresh).toBe(false);
    // No CUP at all (pure text) — chunkHadCup=false, outsideCupFresh=false.
    out = batchSyncFrames(b, `hello world`);
    expect(out.chunkHadCup).toBe(false);
    expect(out.outsideCupFresh).toBe(false);
  });

  it("resets the freshness flags every call (a pure-text chunk after a CUP-carrying chunk reads outsideCupFresh=false, chunkHadCup=false — but lastOutsideCup persists)", () => {
    const b = fresh();
    // Call 1: harvests an outside-sync CUP → outsideCupFresh=true this call;
    // lastOutsideCup = {21, 3} persists on the batcher across calls.
    const out1 = batchSyncFrames(b, `\x1b[21;3H`);
    expect(out1.outsideCupFresh).toBe(true);
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 });
    // Call 2: pure passthrough, no CUP — the per-call flags MUST reset to
    // false even though lastOutsideCup is non-null on the batcher. A stale
    // `true` here would route a TYPING chunk to TerminalPane's streaming
    // re-anchor branch and re-introduce the "blinker on H" snap.
    const out2 = batchSyncFrames(b, `plain text no escape`);
    expect(out2.outsideCupFresh).toBe(false);
    expect(out2.chunkHadCup).toBe(false);
    expect(b.lastOutsideCup).toEqual({ row: 21, col: 3 }); // anchor persists
  });

  it("outsideCupFresh=false + chunkHadCup=true for a codex TYPING chunk (routes (3b) to the body-anchor heuristic)", () => {
    // Codex typing cycle (post-strip shape the batcher sees): codex repaints
    // the prompt-input row INSIDE a `?2026h`…`?2026l` frame whose body CUP
    // lands at the cell AFTER the just-typed 'H' (here 22;4). No outside-sync
    // re-anchor pulse is emitted during typing — codex only re-emits that
    // pulse on STREAMING cycles; typing just rewrites the body in place.
    const b = fresh();
    // Call 1: seed the STALE outside anchor the typing heuristic will compare
    // rows against — codex's prompt-input cell at the start of typing.
    batchSyncFrames(b, `${SYNC_OPEN}prev${SYNC_CLOSE}\x1b[22;3H`);
    expect(b.lastOutsideCup).toEqual({ row: 22, col: 3 });
    // Call 2: the typing chunk itself. The body CUP at {22,4} is INSIDE the
    // frame → lastBodyCup = {22,4}, bodyCupFresh=true. NO outside-sync CUP
    // this chunk → outsideCupFresh=false, lastOutsideCup unchanged (= stale
    // {22,3}, the prompt-start cell where the typed H lands — exactly what
    // the old (3b) would have snapped the cursor back onto).
    const out = batchSyncFrames(b, `${SYNC_OPEN}\x1b[22;4HH${SYNC_CLOSE}`);
    expect(out.outsideCupFresh).toBe(false);
    expect(out.chunkHadCup).toBe(true);
    expect(b.lastBodyCup).toEqual({ row: 22, col: 4 });
    expect(b.lastOutsideCup).toEqual({ row: 22, col: 3 }); // stale, unchanged
  });

  it("outsideCupFresh=false + chunkHadCup=false for an opencode TYPING chunk (routes (3b) to the no-CUP fallthrough)", () => {
    // Opencode's keystroke echo (post-strip, as observed in `__opencode_probe`):
    //   `?2026h ?2026l SGR a CSI 56X` — an EMPTY sync pair (open immediately
    //   close, no body) + then the literal char `a` written OUTSIDE the frame
    //   with NO CUP at all (xterm's own write advances the cursor one cell
    //   along). TerminalPane's (3b) no-CUP branch lets that natural advance
    //   stand — that IS the opencode typing-cursor fix.
    const b = fresh();
    const out = batchSyncFrames(
      b,
      `${SYNC_OPEN}${SYNC_CLOSE}\u001b[32ma\u001b[0m\u001b[56X`,
    );
    expect(out.outsideCupFresh).toBe(false);
    expect(out.chunkHadCup).toBe(false);
    expect(b.lastBodyCup).toBeNull();
    expect(b.lastOutsideCup).toBeNull(); // never seeded either
  });
});
