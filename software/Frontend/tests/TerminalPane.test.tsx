// TerminalPane — single pane lifecycle. Asserts:
//   (1) the bridge ptySpawn is called on mount with the paneId + initial
//       geometry (80x24);
//   (2) the data roundtrip — an `onPtyData` event for this pane is written
//       onto the (mock) xterm canvas; events for other panes are filtered out;
//   (3) the exit path — `onPtyExit` flips the terminals-store pane alive=false
//       with the routed exitCode.
// The xterm Terminal class is globally mocked in setupTests.ts; we drive the
// data event through the seized `onPtyData` lambda and read back through
// `Xterm.__last()`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { makeTestBridge } from "../setupTests";
import * as Xterm from "@xterm/xterm";
import { ThemeProvider } from "@/themes";
import { TerminalPane } from "@/terminals/TerminalPane";
import { useTerminalsStore } from "@/stores/terminals";

type Pty = ReturnType<typeof makeTestBridge>;
type DataEvent = { paneId: string; type: "data"; data: string };
type ExitEvent = { paneId: string; type: "exit"; exitCode: number };

beforeEach(() => {
  // Drop mock-Terminal instances left over from other tests so __last()
  // always refers to the one this render mounted.
  const x = Xterm as unknown as { __reset?: () => void };
  x.__reset?.();
});

afterEach(() => {
  cleanup();
});

function setBridge(bridge: Pty): void {
  (window as unknown as { bridge: Pty }).bridge = bridge;
}

describe("TerminalPane", () => {
  it("spawns a pty on mount with the paneId + initial geometry", () => {
    const spawn = vi.fn(
      async (opts: { paneId: string; cols: number; rows: number }) => ({
        paneId: opts.paneId,
        shell: "pwsh",
        cols: opts.cols,
        rows: opts.rows,
        cwd: "/home/test",
      }),
    );
    setBridge(makeTestBridge({ ptySpawn: spawn }));
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[0]).toMatchObject({
      paneId: "probe",
      cols: 80,
      rows: 24,
    });
  });

  it("writes incoming onPtyData events to the xterm canvas (data roundtrip)", async () => {
    let seizeData: ((evt: DataEvent) => void) | null = null;
    setBridge(
      makeTestBridge({
        onPtyData: (cb) => {
          seizeData = cb as (evt: DataEvent) => void;
          return () => undefined;
        },
      }),
    );
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    // Microtask round so the mount effect's async spawn resolves and the
    // `onPtyData` subscription is registered before we drive the event.
    await Promise.resolve();
    await Promise.resolve();

    const mock = (
      Xterm as unknown as {
        __last?: () => { write: ReturnType<typeof vi.fn> };
      }
    ).__last?.();
    expect(mock, "expected a mock Terminal instance from Xterm.__last").toBeDefined();
    expect(seizeData).not.toBeNull();
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "hello\r\n",
    });
    expect(mock!.write).toHaveBeenCalledWith("hello\r\n");
  });

  it("marks the pane exited on onPtyExit with the routed exitCode", async () => {
    let seizeExit: ((evt: ExitEvent) => void) | null = null;
    setBridge(
      makeTestBridge({
        onPtyExit: (cb) => {
          seizeExit = cb as (evt: ExitEvent) => void;
          return () => undefined;
        },
      }),
    );
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    seizeExit!({
      paneId: "probe",
      type: "exit",
      exitCode: 9,
    });
    const pane = useTerminalsStore.getState().panes["probe"];
    expect(pane?.alive).toBe(false);
    expect(pane?.exitCode).toBe(9);
  });

  it("hides cursor on sync-open (pre-body) + programmatic `CUP <anchor>;?25h` re-anchor+show on sync-close inside TUI (steady prompt-cell blinker through codex's stream), and `?25h` + cursorBlink=true on TUI leave", async () => {
    // The empirical-steady-blinker architecture.
    //
    // PROBLEM (user complaint "blink stays even after I send the prompt"): codex
    // emits an outside-sync `CUP <prompt-input-row>;<3>` + `?25h` re-anchor
    // pulse after every sync close (per `__codex_probe.log` — 33 of 36 such
    // shows pair with `CUP 21;3` during streaming, `CUP 17;3` during the
    // early banner phase). But xterm renders the body-lastCup cursor cell
    // VISIBLE at sync close BEFORE codex's outside-sync re-anchor pulse
    // arrives — so the user sees the blinker hop onto the footer row
    // (23;52), the response row (18;col advancing), the working banner
    // ... the "blinking the hell out / going around" symptom. The previous
    // idle-aware valve (hide on close, show after 500 ms idle) eliminated
    // the hopping by hiding through the stream — but it also killed the
    // visible blinker during streaming (the user's NEW complaint).
    //
    // FIX (this test pins the architecture):
    //   (3a) HIDE on sync-OPEN, BEFORE the for-loop writes the (stripped)
    //        body. The strip in test #5 already strips codex's intra-body
    //        `?25h`/`?25l` so codex can't re-show mid-frame → the body
    //        processes through xterm with `isCursorHidden=true` → xterm
    //        paints NO cursor cell at body-lastCup at sync close → no
    //        hopping. The hide fires when `stripActive && (depthBefore > 0
    //        || chunk.includes(SYNC_OPEN))` — covers both the
    //        open+close-in-one-chunk case (`chunk.includes(SYNC_OPEN)`
    //        trips even though `batched.hasOpenFrame===false` because depth
    //        closed inside the same chunk) and the cross-chunk case
    //        (`depthBefore > 0`: this chunk inherits an open frame from
    //        the previous chunk).
    //   (3b) RE-ANCHOR + SHOW at codex's stable prompt-input cell after
    //        every sync close, writing `\u001b[<row>;<col>H\u001b[?25h`
    //        programmatically. `(row, col)` comes from
    //        `SyncBatcher.lastOutsideCup` — tracked by `scanOutsideCups` in
    //        the batcher's depth=0 passthrough path (codex's own
    //        outside-sync `CUP <row>;<col>H` pulse). The post-loop write
    //        coalesces with the for-loop's body-close emit inside xterm's
    //        DomRenderer requestAnimationFrame batch → user sees ONE
    //        committed render with cursor at the stable cell, never an
    //        interim body-lastCup render. The cell position is IDENTICAL
    //        every cycle → xterm's cursor `<span>` isn't recreated →
    //        `@keyframes blink_block_* 1s step-end infinite` keeps its
    //        phase → the M2 1 Hz alive-cue pulse runs steady through the
    //        entire stream. The OLD `cursorIdleShowTimer` 500 ms valve is
    //        retired (this test replaces the old "writes `?25l` on
    //        sync-close inside TUI (idle-aware...)" name).
    //   Falling TUI edge (`actions.restoreBlink`): write `?25h` once so the
    //        bare shell prompt re-arms its alive-cue blink + reaffirm
    //        `cursorBlink = true` for the bare-shell M2 pulse.
    //
    // CHUNK A (below) carries codex's REAL post-close cycle signature:
    // open + body + close, THEN an outside-sync `CUP 21;3` + `?25h`. The
    // `?25h` is stripped pre-batch (so the strip's no-strobe goal holds),
    // but the `CUP 21;3` survives the strip — `scanOutsideCups` in the
    // batcher's depth=0 path captures it, and (3b)'s post-close write
    // used that anchor to re-show at (21, 3). CHUNK B mirrors an
    // alt-screen TUI leave; the latch falls and `restoreBlink` writes the
    // final `?25h` for the bare shell.
    let seizeData: ((evt: DataEvent) => void) | null = null;
    setBridge(
      makeTestBridge({
        onPtyData: (cb) => {
          seizeData = cb as (evt: DataEvent) => void;
          return () => undefined;
        },
      }),
    );
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    // Microtask round so the mount effect's async spawn resolves and the
    // `onPtyData` subscription is registered before we drive the event.
    await Promise.resolve();
    await Promise.resolve();
    expect(seizeData, "expected bridge.onPtyData to have registered a callback")
      .not.toBeNull();

    const mock = (
      Xterm as unknown as {
        __last?: () => {
          write: ReturnType<typeof vi.fn>;
          options: Record<string, unknown>;
        };
      }
    ).__last?.();
    expect(mock, "expected a mock Terminal instance from Xterm.__last").toBeDefined();
    // Mount state — `cursorBlink: true` is TerminalPane's mount option.
    expect(mock!.options.cursorBlink).toBe(true);

    // Snapshot write indices so we can isolate which writes came from
    // CHUNK A vs which came from the mount phase (which wouldn't fire
    // any of these — the mount writes go through a different path, but
    // snapshotting keeps the test robust against future mount-time
    // writes intentionally added).
    const baselineBeforeA = mock!.write.mock.calls.length;

    // CHUNK A — TUI rising edge + a complete sync frame + codex's
    // post-close outside-sync CUP `21;3` (the prompt-input re-anchor).
    // After strip (\?25h/\?25l removed), this is:
    //   `\x1b[?2026h body \x1b[?2026l\x1b[21;3H`
    // The batcher flushes the frame as one emit `[?2026h body ?2026l]`
    // AND pushes `[21;3H]` as a depth=0 passthrough — `scanOutsideCups`
    // captures (21, 3) on `SyncBatcher.lastOutsideCup`. (3a)'s hide-on-open
    // writes `?25l` BEFORE the for-loop; (3b)'s post-close writes
    // `\x1b[21;3H\x1b[?25h` AFTER the for-loop. The latch rising edge
    // fires `markTuiEntered` (chip strip hides) — NO cursor write at the
    // rising edge.
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026h body \x1b[?2026l\x1b[21;3H\x1b[?25h",
    });
    expect(mock!.options.cursorBlink).toBe(true); // held steady — no rising-edge flip

    // Collect CHUNK A's writes IN ORDER. We expect, in sequence:
    //   (3a) hide-on-open: `\x1b[?25l`
    //   for-loop emit #1: `\x1b[?2026h body \x1b[?2026l`
    //   for-loop emit #2: `\x1b[21;3H`
    //   (3b) anchor+show: `\x1b[21;3H\x1b[?25h`
    const argsA = mock!.write.mock.calls
      .slice(baselineBeforeA)
      .map((c) => String(c[0]));
    expect(argsA.length, "expected 4 writes from CHUNK A: hide, frame, anchor passthrough, anchor+show").toBe(4);
    // (3a) hide-on-open — fires FIRST so xterm's `isCursorHidden=true` is
    // set BEFORE the for-loop seeds the body paint into xterm's parser.
    expect(argsA[0]).toBe("\x1b[?25l");
    // for-loop emit — the body bytes feed through xterm verbatim (strip is
    // a no-op on the body itself; only `?25h` got stripped).
    expect(argsA[1]).toBe("\x1b[?2026h body \x1b[?2026l");
    expect(argsA[2]).toBe("\x1b[21;3H");
    // (3b) RE-ANCHOR + SHOW — the steady-blinker's payload. CUP `21;3`
    // pins the cursor at codex's prompt-input cell; `?25h` re-shows it.
    expect(argsA[3]).toBe("\x1b[21;3H\x1b[?25h");

    // Snapshot again so CHUNK B's writes are isolated from any latch-side
    // effects still pending from CHUNK A.
    const baselineBeforeB = mock!.write.mock.calls.length;

    // CHUNK B — TUI leave: `?1049l` mirrors an alt-screen TUI exit. The
    // latch's falling edge fires `restoreBlink` → `?25h` write +
    // `cursorBlink=true`. NO sync close in this chunk → (3b)'s anchor+show
    // branch is a no-op; no `SYNC_OPEN` and depth=0 → (3a)'s hide-on-open
    // is a no-op.
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?1049l",
    });
    const argsB = mock!.write.mock.calls
      .slice(baselineBeforeB)
      .map((c) => String(c[0]));
    // First (and should-be-only) write is the alt-screen leave verbatim;
    // `restoreBlink` is the SECOND write (`?25h`).
    expect(argsB[0]).toBe("\x1b[?1049l");
    expect(argsB[1]).toBe("\x1b[?25h");
    expect(mock!.options.cursorBlink).toBe(true);
  });

  it("strips codex's outside-sync-frame `?25l`/`?25h` strobe from xterm.write while a TUI is running", async () => {
    // The actual no-blink fix. While the latch says a TUI owns the pane, the
    // onPtyData watcher feeds each chunk through `stripCursorVisibilityModes`
    // BEFORE `terminal.write`, so codex's per-frame `?25l` (hide) /
    // `?25h` (show) — which xterm renders immediately outside any sync frame
    // (`?2026h`…`?2026l`) — never reach the parser. `coreService.
    // isCursorHidden` then stays at its initial `false` and xterm paints a
    // steady inverse `xterm-cursor-block` at each flush (no per-frame strobe).
    // This test drives a RISING-EDGE enter (chunk #1 = a sync frame, no
    // `?25l`) and then a steady-state flashing chunk (#2 = `?25l`/`?25h`
    // outside any sync frame, the worst-case from `.codex-capture2/raw.bin`).
    // After #2: NO `terminal.write` call carries `\x1b[?25l` or `\x1b[?25h`,
    // but the chunk's BODY TEXT did pass through.
    let seizeData: ((evt: DataEvent) => void) | null = null;
    setBridge(
      makeTestBridge({
        onPtyData: (cb) => {
          seizeData = cb as (evt: DataEvent) => void;
          return () => undefined;
        },
      }),
    );
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(seizeData, "expected bridge.onPtyData registered").not.toBeNull();
    const mock = (
      Xterm as unknown as {
        __last?: () => {
          write: ReturnType<typeof vi.fn>;
          options: Record<string, unknown>;
        };
      }
    ).__last?.();
    expect(mock, "expected a mock Terminal instance from Xterm.__last").toBeDefined();

    // Chunk #1 — RISING-EDGE sync open: `?2026h … ?2026l`. No `?25l` so the
    // strip is observationally a no-op for this chunk; the latch rises and the
    // strip gate turns ON for everything after.
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026hcodex welcome screen\x1b[?2026l",
    });
    expect(mock!.options.cursorBlink).toBe(true); // held steady — rising-edge flip retired

    // Snapshot the write log; everything past this index is the steady-state.
    const baseline = mock!.write.mock.calls.length;

    // Chunk #2 — OUTSIDE-sync-frame strobe: codex's `?25l` + `?25h` toggles
    // outside any `?2026h`/`?2026l` window (xterm renders these IMMEDIATELY →
    // the strobe). This chunk is identical in shape to codex's inter-frame
    // bytes in `.codex-capture2/raw.bin` (after a sync flush codex emits a
    // stray `?25l`, sits idle, then before the next sync open emits `?25h`).
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?25l idle text \x1b[?25h trailing prompt",
    });

    // Pull every write arg from chunk #2 onward and assert:
    //   (a) NEITHER `\x1b[?25l` NOR `\x1b[?25h` survives the strip.
    //   (b) The body text "idle text" + "trailing prompt" did pass through
    //       (xterm still painted codex's prompt chrome — only the cursor
    //       toggles were dropped).
    const chunk2Args = mock!.write.mock.calls
      .slice(baseline)
      .map((c) => String(c[0]))
      .join("\u0000");
    expect(chunk2Args).not.toContain("\x1b[?25l");
    expect(chunk2Args).not.toContain("\x1b[?25h");
    expect(chunk2Args).toContain("idle text");
    expect(chunk2Args).toContain("trailing prompt");

    // The DECSDM pair (`?12h`/`?12l`) — codex emits zero of these today, but
    // the strip removes them too as defense against TUIs that would otherwise
    // flip rawOptions.cursorBlink via the OptionsProxy setter. Verify with a
    // third steady-state chunk.
    const baseline2 = mock!.write.mock.calls.length;
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "before\x1b[?12hmid\x1b[?12lafter",
    });
    const chunk3Args = mock!.write.mock.calls
      .slice(baseline2)
      .map((c) => String(c[0]))
      .join("\u0000");
    expect(chunk3Args).not.toContain("\x1b[?12h");
    expect(chunk3Args).not.toContain("\x1b[?12l");
    expect(chunk3Args).toContain("before");
    expect(chunk3Args).toContain("mid");
    expect(chunk3Args).toContain("after");
  });

  it("(3b) body-anchor heuristic keeps the codex typing cursor at the natural cell-after-the-char (NOT the stale outside anchor the OLD (3b) snapped it back onto — the 'blinker on H' bug)", async () => {
    // The user-complaint fix for codex typing. While the user types into a
    // running codex prompt, codex repaints the prompt-input row INSIDE a
    // `?2026h`…`?2026l` frame whose body CUP re-positions the cursor at the
    // cell AFTER the just-typed char (here 22;4 after painting 'H' at 22;3).
    // NO outside-sync re-anchor pulse is emitted during typing — codex only
    // re-emits that pulse on STREAMING cycles. lastOutsideCup therefore stays
    // STALE (still pinned to {22, 3}, the pre-typing prompt start where the
    // typed H lands). The OLD (3b) wrote `\u001b[<stale-anchor>H\u001b[?25h`
    // unconditionally → snapped the cursor BACK onto the just-typed H. The
    // discriminator's chunkHadCup && lastBodyCup.row == lastOutsideCup.row
    // path anchors to body-lastCup = {22, 4} → cursor lands AFTER the H.
    let seizeData: ((evt: DataEvent) => void) | null = null;
    setBridge(
      makeTestBridge({
        onPtyData: (cb) => {
          seizeData = cb as (evt: DataEvent) => void;
          return () => undefined;
        },
      }),
    );
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(seizeData, "expected bridge.onPtyData to have registered a callback")
      .not.toBeNull();
    const mock = (
      Xterm as unknown as {
        __last?: () => {
          write: ReturnType<typeof vi.fn>;
          options: Record<string, unknown>;
        };
      }
    ).__last?.();
    expect(mock, "expected a mock Terminal instance").toBeDefined();

    // CHUNK A — rising edge + the streaming-cycle pulse that seeds
    // lastOutsideCup = {22, 3}: open frame, body, close, then codex's per-
    // close outside-sync re-anchor `CUP 22;3 ?25h`. The strip drops the
    // trailing `?25h`; the `CUP 22;3` survives → (3b)'s fresh-outside branch
    // pins the cursor at {22, 3} for the streaming steady-blinker path AND
    // seeds the STALE anchor the typing chunk below is compared against.
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026h prev \x1b[?2026l\x1b[22;3H\x1b[?25h",
    });

    // CHUNK B — the typing cycle. Post-strip: `?2026h [CUP 22;3] H
    // [CUP 22;4] ?2026l` — body paints 'H' at 22;3 then re-CUPs to 22;4
    // (the natural after-char cell). NO outside-sync re-anchor this chunk →
    // outsideCupFresh=false; chunkHadCup=true (body CUP). Discriminator's
    // heuristic: lastBodyCup.row (22) == lastOutsideCup.row (22) → use
    // lastBodyCup {22, 4} → cursor lands AFTER the H, NOT on it.
    const baseline = mock!.write.mock.calls.length;
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026h\x1b[?25l\x1b[22;3HH\x1b[22;4H\x1b[?25h\x1b[?2026l",
    });
    const argsB = mock!.write.mock.calls
      .slice(baseline)
      .map((c) => String(c[0]));
    // (3a) hide-on-open — fires first, before the for-loop body paint.
    expect(argsB[0]).toBe("\x1b[?25l");
    // for-loop emit — the batched frame (strip removed `?25l`/`?25h`).
    expect(argsB[1]).toBe("\x1b[?2026h\x1b[22;3HH\x1b[22;4H\x1b[?2026l");
    // (3b) body-anchor heuristic → anchor to lastBodyCup {22;4}, NOT the
    // stale lastOutsideCup {22;3} where the just-typed 'H' landed.
    expect(argsB[2]).toBe("\x1b[22;4H\x1b[?25h");
    // Defensive regression mark: the OLD stale-outside snap (the "blinker on
    // H" cause) must NOT appear anywhere in CHUNK B's writes.
    expect(argsB.some((a) => a === "\x1b[22;3H\x1b[?25h")).toBe(false);
  });

  it("(3b) no-CUP fallthrough keeps the opencode typing cursor advancing naturally (the discriminator writes ONLY `?25h`, never a programmatic snap to the stale outside anchor)", async () => {
    // The user-complaint fix for opencode typing. Opencode's keystroke echo is
    // an EMPTY sync pair (`?2026h ?2026l`) + the typed char written OUTSIDE the
    // frame with NO CUP at all (xterm's own write advances the cursor one cell
    // along — per `__opencode_probe`). The OLD (3b) snap to the stale outside
    // anchor would have written `CUP <stale 21;3> ?25h`, jumping the cursor
    // BACK onto the just-typed 'a' (where codex's banner-phase placeholder
    // text sits). The chunkHadCup=false else branch writes ONLY `?25h` — no
    // programmatic CUP — letting xterm's own write advance stand.
    let seizeData: ((evt: DataEvent) => void) | null = null;
    setBridge(
      makeTestBridge({
        onPtyData: (cb) => {
          seizeData = cb as (evt: DataEvent) => void;
          return () => undefined;
        },
      }),
    );
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(seizeData, "expected bridge.onPtyData to have registered a callback")
      .not.toBeNull();
    const mock = (
      Xterm as unknown as {
        __last?: () => {
          write: ReturnType<typeof vi.fn>;
          options: Record<string, unknown>;
        };
      }
    ).__last?.();
    expect(mock, "expected a mock Terminal instance").toBeDefined();

    // CHUNK A — opencode's alt-screen enter (`?1049h` rising edge) + a
    // streaming-cycle pulse seeding lastOutsideCup = {21, 3}. The strip
    // drops the trailer `?25h`; the `CUP 21;3` survives → (3b)'s fresh-
    // outside branch seeds the STALE anchor the typing chunk below would
    // snap onto under the OLD design.
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?1049h\x1b[?2026h stream \x1b[?2026l\x1b[21;3H\x1b[?25h",
    });

    // CHUNK B — opencode's typing-shape keystroke echo. NO `?25l`/`?25h` in
    // this chunk (the blinker strip is a no-op here), NO CUP anywhere →
    // outsideCupFresh=false, chunkHadCup=false. (3b)'s else branch writes
    // ONLY `?25h` — no programmatic cursor move — so xterm's own write (the
    // `a` body text + `CSI 56X` erase-forward, both OUTSIDE the empty sync
    // frame) advances the cursor naturally past `a`, NOT snapped back onto
    // the stale {21, 3} cell.
    const baseline = mock!.write.mock.calls.length;
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026h\x1b[?2026l\u001b[32ma\u001b[0m\u001b[56X",
    });
    const argsB = mock!.write.mock.calls
      .slice(baseline)
      .map((c) => String(c[0]));
    // (3a) hide-on-open — chunk carries SYNC_OPEN.
    expect(argsB[0]).toBe("\x1b[?25l");
    // for-loop emit #1 — the empty sync pair.
    expect(argsB[1]).toBe("\x1b[?2026h\x1b[?2026l");
    // for-loop emit #2 — the typed-char bytes verbatim, OUTSIDE the frame.
    expect(argsB[2]).toBe("\u001b[32ma\u001b[0m\u001b[56X");
    // (3b) no-CUP fallthrough — just `?25h`, NO programmatic CUP. This is the
    // opencode typing fix: xterm's own write already advanced the cursor
    // past `a`; we DON'T snap it back onto the stale {21, 3} anchor.
    expect(argsB[3]).toBe("\x1b[?25h");
    // Defensive regression mark: any `CUP <row>;<col>H ?25h` write (the OLD
    // stale-outside snap) must NOT appear in CHUNK B's writes.
    expect(argsB.some((a) => /\x1b\[\d+;\d+H\x1b\[\?25h/.test(a))).toBe(false);
  });

  it("(3b) split-stream teleporter — body painted in chunk N at a row that mismatches the outside anchor, close arrives ALONE in chunk N+1 (chunkHadCup=false this call) → anchor to STABLE outside (NOT bodyLast) so no interim body-lastCup paint (the actual teleporter fix)", async () => {
    // The SPLIT-cycle teleporter fix — the user's "blinker while not a
    // FUCKING TELEPORTER" ask. codex (per `__codex_probe.log`) often splits a
    // sync frame across TWO onData chunks when ConPTY chops at a `?25h`
    // boundary: chunk N OPENS `?2026h` and paints the body's CUPs through the
    // footer / response / working-banner row (body-lastCup scanned at row
    // 23;52 / 18;col / etc — DIFFERENT row from the prompt); chunk N+1 CLOSES
    // with `?2026l` ALONE. The prior open-frame chunk's `scanInsideCups`
    // harvested the body CUPs into the PERSISTENT `lastBodyCup`; chunk N+1's
    // `scanInsideCups("")` no-ops on the empty pre-close body slice →
    // `bodyCupFresh` resets → `chunkHadCup=false` THIS call EVEN THOUGH
    // `lastBodyCup` STILL holds the body's off-prompt cell from chunk N.
    //
    // The OLD else branch wrote `?25h` UNCONDITIONALLY — re-showing the
    // cursor at body-lastCup for ONE rAF commit (xterm paints the cursor cell
    // there after the for-loop's close-flush run through xterm's parser).
    // Chunk N+2's outside-sync re-anchor pulse `?25l 21;3H ?25h` (post-strip
    // `21;3H`) then pulled the cursor back to the prompt cell at the NEXT
    // rAF commit ⇒ TWO commits at TWO rows = the user-visible "teleporter
    // blinker".
    //
    // The FIX: the else branch mirrors the `chunkHadCup=true` middle
    // branch's row-match heuristic on the PERSISTENT `lastBodyCup`/
    // `lastOutsideCup`. Row mismatch (body painted a different row than the
    // outside anchor) → SPLIT-stream teleporter → anchor to STABLE outside
    // so the cursor SNAPS back to the prompt cell at the SAME rAF commit as
    // the close flush → one commit at the prompt, no interim body-lastCup
    // paint. (Row match stays the typing-cursor-after-char advance — the
    // companion test below pins that path.)
    let seizeData: ((evt: DataEvent) => void) | null = null;
    setBridge(
      makeTestBridge({
        onPtyData: (cb) => {
          seizeData = cb as (evt: DataEvent) => void;
          return () => undefined;
        },
      }),
    );
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(seizeData, "expected bridge.onPtyData to have registered a callback")
      .not.toBeNull();
    const mock = (
      Xterm as unknown as {
        __last?: () => {
          write: ReturnType<typeof vi.fn>;
          options: Record<string, unknown>;
        };
      }
    ).__last?.();
    expect(mock, "expected a mock Terminal instance").toBeDefined();

    // CHUNK A — rising-edge sync frame + the streaming-cycle pulse that seeds
    // `lastOutsideCup = {21, 3}` (codex's stable prompt-input cell). The
    // trailer `?25h` is stripped; the `CUP 21;3` survives → scanOutsideCups
    // captures it as the SPLIT-cycle teleporter's STABLE outside anchor.
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026h stream \x1b[?2026l\x1b[21;3H\x1b[?25h",
    });

    // CHUNK B — the SPLIT-cycle's OPEN+BODY chunk (chunk N: codex opens a
    // frame + paints the response row at 18;4 + leaves the frame OPEN at end
    // of chunk — no `?2026l` close yet). The body is embargoed into
    // `batcher.pending` — the for-loop does NOT write it this chunk. But
    // `scanInsideCups` DID scan the body's CUP `18;4` → persistent
    // `lastBodyCup = {18, 4}`. (3a)'s hide-on-open fires because the chunk
    // carries `?2026h` (depthBefore is 0 since chunk A closed its frame; the
    // SYNC_OPEN secondary gate trips the hide even on a fresh open).
    const baselineBeforeB = mock!.write.mock.calls.length;
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026h\x1b[?25l\x1b[18;4H response\x1b[?25h",
    });
    const argsB = mock!.write.mock.calls
      .slice(baselineBeforeB)
      .map((c) => String(c[0]));
    // (3a) hide-on-open — fires BEFORE the (empty) for-loop. The body bytes
    // are embargoed in `pending` until CHUNK C's close arrives; ONLY the
    // hide gets written to xterm this chunk.
    expect(argsB).toEqual(["\x1b[?25l"]);

    // CHUNK C — the SPLIT-cycle's CLOSE-ONLY chunk (chunk N+1).
    // `scanInsideCups` runs on the EMPTY pre-close body slice (`""`) → no-op
    // → `bodyCupFresh` resets → `chunkHadCup=false` THIS call EVEN THOUGH the
    // persistent `lastBodyCup` from chunk B still holds `{18, 4}`. (3b)'s
    // discriminator enters the ELSE branch — the surgical fix's home.
    const baselineBeforeC = mock!.write.mock.calls.length;
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026l",
    });
    const argsC = mock!.write.mock.calls
      .slice(baselineBeforeC)
      .map((c) => String(c[0]));
    // (3a) hide-on-open — fires again: `depthBefore > 0` (chunk B's open
    // frame is inherited into chunk C; the close-flush run through xterm's
    // parser would land the cursor at body-lastCup, so the (3a) hide preempts
    // that paint).
    expect(argsC[0]).toBe("\x1b[?25l");
    // for-loop emit #1 — the close-flush of the embargoed pending body
    // (opener + body bytes from chunk B + close from this chunk).
    expect(argsC[1]).toBe("\x1b[?2026h\x1b[18;4H response\x1b[?2026l");
    // (3b) THE FIX — the else branch's row-match heuristic. bodyLast.row (18)
    // !== outside.row (21) → SPLIT-stream teleporter → anchor to STABLE
    // `lastOutsideCup = {21, 3}` so the cursor is PINNED to the prompt cell
    // at the SAME rAF commit as the close flush → one commit, one row, no
    // teleporter. (The OLD else branch would have written JUST `\x1b[?25h`
    // — re-showing at body-lastCup `(18, 4)` for one commit before chunk
    // N+2's outside re-anchor pulled the cursor back.)
    expect(argsC[2]).toBe("\x1b[21;3H\x1b[?25h");
    // Defensive regression mark: the OLD teleporter-causing shape (a BARE
    // `\x1b[?25h` write with NO programmatic CUP) must NOT appear in chunk
    // C's writes — that's the symptom the fix replaces.
    expect(argsC.some((a) => a === "\x1b[?25h")).toBe(false);
  });

  it("(3b) split-typing — body's after-char CUP painted in chunk N at the SAME row as the outside anchor, close arrives ALONE in chunk N+1 → anchor to bodyLast (the cell AFTER the just-typed char) so the blinker sits at the natural-typing position (NOT the streaming-teleporter snap-back)", async () => {
    // Companion to the SPLIT-stream teleporter test above. SAME split-cycle
    // shape (body painted in chunk N, `?2026l` alone in chunk N+1) — but the
    // body's last CUP is at the SAME ROW as the outside anchor (a typing
    // cycle: codex re-paints the prompt with a freshly-typed char INSIDE a
    // `?2026h`…`?2026l` frame whose body CUP re-positions the cursor at the
    // cell AFTER the just-typed char). The else branch's row-match heuristic
    // picks the typing-cursor path: anchor to `lastBodyCup` so the blinker
    // sits AFTER the char (NOT on it — the original "blinker on H"
    // complaint) and NOT to the (row-matching) outside anchor
    // `lastOutsideCup` (the pre-typing prompt-input cell where the typed
    // char's glyph now occupies).
    let seizeData: ((evt: DataEvent) => void) | null = null;
    setBridge(
      makeTestBridge({
        onPtyData: (cb) => {
          seizeData = cb as (evt: DataEvent) => void;
          return () => undefined;
        },
      }),
    );
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(seizeData, "expected bridge.onPtyData to have registered a callback")
      .not.toBeNull();
    const mock = (
      Xterm as unknown as {
        __last?: () => {
          write: ReturnType<typeof vi.fn>;
          options: Record<string, unknown>;
        };
      }
    ).__last?.();
    expect(mock, "expected a mock Terminal instance").toBeDefined();

    // CHUNK A — rising-edge sync frame + streaming-cycle pulse seeding
    // `lastOutsideCup = {22, 3}` (the pre-typing prompt-input start, where
    // the just-typed H will land). Same pattern as the teleporter test's
    // CHUNK A but at row 22.
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026h stream \x1b[?2026l\x1b[22;3H\x1b[?25h",
    });

    // CHUNK B — the SPLIT-cycle's OPEN+BODY chunk (codex opens a frame +
    // paints the typed 'H' at 22;3 then CUPs to 22;4 for the next char). The
    // body slice is `\x1b[22;3HH\x1b[22;4H`; `scanInsideCups` runs on it,
    // matching `22;3H` first then `22;4H` (the LAST hit wins) → persistent
    // `lastBodyCup = {22, 4}` (the cell AFTER the just-typed 'H'). Frame is
    // left OPEN at end of chunk (no `?2026l`), body embargoed in
    // `batcher.pending`.
    const baselineBeforeB = mock!.write.mock.calls.length;
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026h\x1b[?25l\x1b[22;3HH\x1b[22;4H\x1b[?25h",
    });
    const argsB = mock!.write.mock.calls
      .slice(baselineBeforeB)
      .map((c) => String(c[0]));
    // (3a) hide-on-open — `chunk.includes(SYNC_OPEN)` trips (depthBefore=0
    // since chunk A closed its frame; the SYNC_OPEN secondary gate fires).
    expect(argsB).toEqual(["\x1b[?25l"]);

    // CHUNK C — close-only. SAME chunkHadCup=false shape as the teleporter
    // test — but here `lastBodyCup.row (22) === lastOutsideCup.row (22)`, so
    // the else branch's row-match heuristic picks the TYPING path (anchor
    // to bodyLast → cursor AFTER the 'H'), NOT the streaming-teleporter
    // path (anchor to outside → cursor on the pre-typing prompt-input cell
    // where the 'H' glyph now occupies).
    const baselineBeforeC = mock!.write.mock.calls.length;
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "\x1b[?2026l",
    });
    const argsC = mock!.write.mock.calls
      .slice(baselineBeforeC)
      .map((c) => String(c[0]));
    // (3a) hide-on-open — `depthBefore > 0` (chunk B's open frame inherited).
    expect(argsC[0]).toBe("\x1b[?25l");
    // for-loop emit — close-flush of the embargoed pending body (opener +
    // `22;3` + 'H' + `22;4` + close).
    expect(argsC[1]).toBe("\x1b[?2026h\x1b[22;3HH\x1b[22;4H\x1b[?2026l");
    // (3b) row-MATCH anchor — bodyLast.row (22) === outside.row (22) →
    // TYPING → anchor `lastBodyCup = {22, 4}` so the cursor sits AFTER the
    // just-typed 'H' (NOT on it, AND NOT snapped back onto the pre-typing
    // outside anchor `{22, 3}` where the 'H' glyph now occupies).
    expect(argsC[2]).toBe("\x1b[22;4H\x1b[?25h");
    // Defensive regression mark: the streaming-teleporter anchor (outside
    // `{22, 3}`) must NOT be the chosen anchor — even though it row-matches,
    // the heuristic deliberately prefers the after-char bodyLast so the
    // blinker sits at the natural-typing position (the original "blinker on
    // H" fix still holds when the typing body CUP is split across chunks).
    expect(argsC.some((a) => a === "\x1b[22;3H\x1b[?25h")).toBe(false);
  });
});
