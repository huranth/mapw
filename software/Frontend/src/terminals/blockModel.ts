// Per-pane block aggregator. Takes OSC 133 + OSC 7 events emitted by the
// user's shell (via the shell-integration rc sourced first thing at spawn)
// and folds them into a list of `Block`s — each block representing one
// prompt → command → output → command-end cycle. The renderer paints a
// left-gutter stripe per block, colour-coded by exit code (muted ink for
// 0, red-seal for non-zero).
//
// This module is PURE: no React, no xterm import except for the `IMarker`
// TYPE (type-only — vanishes at runtime). The `Terminal` instance stays on
// the caller side; the caller captures any markers it wants to bind to an
// event and passes them in alongside the event itself.

import type { IMarker } from "@xterm/xterm";
import type { OscEvent } from "@bridgespace/backend/renderer";

export type BlockStatus = "open" | "closed";

export interface Block {
  /** Monotonic, stable id for React keys + chip positioning keys. */
  readonly id: string;
  /** xterm marker pinned to the line where `133;A` (promptStart) was drawn.
   *  Null when the caller has no terminal handy (pure-logic tests). */
  readonly promptMarker: IMarker | null;
  /** Marker pinned to the line where `133;D;<exit>` was drawn. Null while
   *  the block is still open, and after closing when the caller chose not
   *  to capture a marker. */
  exitMarker: IMarker | null;
  /** Exit code; null until the block closes. */
  exitCode: number | null;
  /** cwd from the most recent OSC 7 emission captured for this block. */
  cwd: string | null;
  hostname: string | null;
  /** Wall-clock when `133;A` arrived for this block. */
  startedAt: number;
  closedAt: number | null;
  status: BlockStatus;
}

export interface BlockModelState {
  /** Time-ordered list of blocks; newest at the tail. */
  blocks: Block[];
  /** The currently open block — set by promptStart, cleared by commandEnd.
   *  Null in the gap between D and the next A (a transient no-prompt state). */
  current: Block | null;
  /** Last observed cwd/hostname, lifted for the pane's exit-code chip. */
  cwd: string | null;
  hostname: string | null;
}

export function createBlockModel(): BlockModelState {
  return { blocks: [], current: null, cwd: null, hostname: null };
}

let blockSeq = 0;
function nextBlockId(): string {
  // Two-digit prefix keeps the IDs scroll-friendly in devtools.
  blockSeq += 1;
  return `blk-${blockSeq.toString(36)}-${Date.now().toString(36)}`;
}

export interface OscEventMarkers {
  /** Marker captured at the promptStart line; bound to the new block. */
  readonly prompt?: IMarker | null;
  /** Marker captured at the commandEnd line; bound to the closing block. */
  readonly exit?: IMarker | null;
}

/** Pure state transition. The caller hands us the current state, the event,
 *  and any captured markers; we return the next state. No mutation of the
 *  input.
 *
 *  Lifecycle, in `precmd` order at every prompt redraw:
 *    `commandEnd` (exit code, optional on the very-first prompt) →
 *    `cwd` (OSC 7) →
 *    `promptStart` (opens the next block).
 *  Power shells (bash/zsh) also emit `133;B` (commandStart) and `133;C`
 *  (outputStart) between A and D — finer-than-block granularity that we
 *  observe but do NOT split on in M1; a block runs from one promptStart to
 *  the next commandEnd. */
export function handleOscEvent(
  state: BlockModelState,
  event: OscEvent,
  markers: OscEventMarkers = {},
): BlockModelState {
  switch (event.type) {
    case "promptStart": {
      const block: Block = {
        id: nextBlockId(),
        promptMarker: markers.prompt ?? null,
        exitMarker: null,
        exitCode: null,
        cwd: state.cwd,
        hostname: state.hostname,
        startedAt: Date.now(),
        closedAt: null,
        status: "open",
      };
      return {
        ...state,
        current: block,
        blocks: [...state.blocks, block],
      };
    }
    case "commandEnd": {
      const current = state.current;
      if (!current) {
        // Orphan D fired before any A (typically the very-first prompt for
        // shells that emit D as a "previous command's exit" marker even at
        // session start). We drop the orphan; no block exists yet.
        return state;
      }
      const closed: Block = {
        ...current,
        exitMarker: markers.exit ?? null,
        exitCode: event.exitCode,
        closedAt: Date.now(),
        status: "closed",
      };
      return {
        ...state,
        current: null,
        blocks: state.blocks.map((b) => (b.id === current.id ? closed : b)),
      };
    }
    case "cwd": {
      const cwd = event.path;
      const hostname = event.hostname;
      const current = state.current;
      if (current) {
        const updated: Block = { ...current, cwd, hostname };
        return {
          ...state,
          cwd,
          hostname,
          current: updated,
          blocks: state.blocks.map((b) => (b.id === current.id ? updated : b)),
        };
      }
      return { ...state, cwd, hostname };
    }
    case "commandStart":
    case "outputStart":
      // Finer-than-block markers — observed but not load-bearing for M1.
      return state;
  }
}

/** Dispose every IMarker the model still holds. Called from TerminalPane's
 *  unmount cleanup so the markers don't outlive the terminal. */
export function disposeBlockModel(state: BlockModelState): void {
  for (const block of state.blocks) {
    try {
      block.promptMarker?.dispose();
    } catch {
      // Marker may already be disposed by the terminal; ignore.
    }
    try {
      block.exitMarker?.dispose();
    } catch {
      // ditto.
    }
  }
}
