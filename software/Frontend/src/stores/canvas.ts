// Canvas — owns the freeform node graph for the terminal surface. Each node's
// body is one <TerminalPane paneId={id}>. `addTerminal(cwd)` seeds an
// offset-new node so the next spawn won't cover the previous; `removeNode(id)`
// deletes one and React Flow unmounts the wrapped TerminalPane — its cleanup
// dispatches the ptyKill IPC for free. `onNodesChange` forwards React Flow's
// drag/select mutations through `applyNodeChanges`.
//
// Hydration: the store initializes to `nodes: []`. Workspace's boot gate calls
// `hydrate(persisted)` BEFORE flipping phase to `ready` (so before the canvas
// mounts). The persisted PaneNodePersist[] comes from Settings.workspace
// ("Continue" path) or from `seedNodes(cwds)` (Welcome commit). Live
// add/remove/drag are mirrored back to Settings via a debounced useEffect in
// TerminalCanvas that round-trips through `updateSettings({workspace})`.

import { create } from "zustand";
import {
  applyNodeChanges,
  type Node,
  type OnNodesChange,
} from "@xyflow/react";
import type { PaneNodePersist } from "@bridgespace/backend/renderer";

// Node chrome metrics in React Flow user-space px. The header is 26px and the
// body fills the rest; the .node-terminal CSS lays out inside these bounds
// (width / height are applied to the node via the store so React Flow sizes
// the wrapper div that owns this content box).
export const NODE_W = 560;
export const NODE_H = 320;
export const GRID_GAP = 36;

// Default 2×2 seed slot layout (positive X walks right, positive Y walks
// down — React Flow's screen-space convention). The Welcome flow shares this
// geometry when committing an "all 4 same folder" or "different folder per
// pane" workspace; the Returning migration path also uses this shape for the
// legacy-lastCwd-to-4-pane upgrade.
function seedSlots(): Array<{ x: number; y: number }> {
  return [
    { x: 0, y: 0 },
    { x: NODE_W + GRID_GAP, y: 0 },
    { x: 0, y: NODE_H + GRID_GAP },
    { x: NODE_W + GRID_GAP, y: NODE_H + GRID_GAP },
  ];
}

// Grid slot generator used by the built-in Split 2×2 preset (and available
// to future layouts that want taller/wider grids). Same convention as
// seedSlots — positive X right, positive Y down — at the canvas's NODE_W +
// NODE_H + GRID_GAP cell pitch. Built-ins consume the result directly so the
// layout's pane positions never drift from what a Welcome-commit 2×2 looks
// like on the live canvas (positions are pure data: x = col * (NODE_W +
// GRID_GAP), y = row * (NODE_H + GRID_GAP)).
export function seedGridSlots(
  rows: number,
  cols: number,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: c * (NODE_W + GRID_GAP),
        y: r * (NODE_H + GRID_GAP),
      });
    }
  }
  return out;
}

// Build the persisted `Settings.workspace.nodes` skeleton for the Welcome
// flow's commit payload (or Returning's legacy migration). Returns a
// 4-element PaneNodePersist[] with the default 2×2 slot positions — the cwds
// array may carry nulls (degraded pane state); hydrate() restores them as
// `data.cwd = null` and TerminalPane's resolved-cwd chain falls back through
// Settings.lastCwd to os.homedir(). The optional parallel `cliIds` array
// (one entry per pane, null/omit = raw-shell pane) carries the saved-layout
// CLI binding — built-in pair/trio layouts seed with `codex`/`claude`/
// `opencode` ids; the default Welcome commit leaves it absent so the boot-
// default 4-pane boot stays raw-shell (the existing first-run behavior,
// preserved through the `cliId !== undefined` opt-in here).
export function seedNodes(
  cwds: (string | null)[],
  cliIds?: (string | null)[],
): PaneNodePersist[] {
  const slots = seedSlots();
  // `slots[i]` / `cwds[i]` / `cliIds?.[i]` carry the `| undefined` from
  // `noUncheckedIndexedAccess`; `?? null` (cwd / cliId) and `?? {0,0}`
  // (position) coerce the hole case back to a finite seed shape. We only
  // ever build a 4-pane skeleton here, so the hole branch is unreachable in
  // practice but typecheck-clean only with the coalesce.
  return [0, 1, 2, 3].map((i) => ({
    paneId: `p${i + 1}`,
    cwd: cwds[i] ?? null,
    position: slots[i] ?? { x: 0, y: 0 },
    cliId: cliIds?.[i] ?? null,
  }));
}

// Convenience for the Returning migration path (legacy lastCwd → 4 same-folder
// panes). Distinct from seedNodes() because most callers want the cwds list
// precisely because the per-pane mode has a different folder per slot.
export function seedNodesWithCwd(cwd: string | null): PaneNodePersist[] {
  return seedNodes([cwd, cwd, cwd, cwd]);
}

// Map a persisted skeleton back to live React Flow Node[] (the inverse of the
// serialize pass in TerminalCanvas's debounced write-back). Sharing this
// helper between `hydrate` and `__resetCanvasForTests` keeps the slot
// geometry in one place.
function nodesFromPersist(persisted: PaneNodePersist[]): Node[] {
  return persisted.map((p) => ({
    id: p.paneId,
    type: "terminal",
    position: p.position,
    data: { cwd: p.cwd, cliId: p.cliId ?? null },
    width: p.size?.width ?? NODE_W,
    height: p.size?.height ?? NODE_H,
  }));
}

// Default 4-node seed shape for tests — TerminalCanvas.test.tsx mounts the
// canvas directly (bypassing Workspace's hydrate) so the store needs to
// arrive at the 2x2 grid when reset; the live app no longer relies on this
// (it hydrates from Settings.workspace instead).
function defaultSeedNodes(): Node[] {
  return nodesFromPersist(seedNodes([null, null, null, null]));
}

interface CanvasState {
  nodes: Node[];
  onNodesChange: OnNodesChange;
  addTerminal: (cwd: string | null, cliId?: string | null) => void;
  removeNode: (id: string) => void;
  hydrate: (persisted: PaneNodePersist[]) => void;
  // Mint a fresh paneId from the module-scope counter — used by `applyLayout`
  // (Frontend/src/stores/layouts.ts) to re-key every pane in a layout being
  // applied, so React Flow reconciles them as MOUNTS (not prop-changes on
  // same-id nodes from the prior canvas, which would leave the old PTY
  // sessions running under the new layout's positions). Bumps nextPaneId per
  // call.
  freshPaneId: () => string;
}

// Next paneId counter for `addTerminal` beyond the initial seed. Lives at
// module scope so it persists for the worker's module lifetime across React
// re-mounts. `hydrate` re-pins this past any restored numeric pane id so
// subsequent "+ New terminal" clicks after a restore don't clash with a
// restored id (e.g. restore saved "p5" → next click spawns "p6").
let nextPaneId = 5;

export const useCanvasStore = create<CanvasState>((set) => ({
  // Starts empty — hydrate() fills before the canvas mounts. The Welcome /
  // Returning screens gate the canvas mount behind the `ready` phase.
  nodes: [],
  onNodesChange: (changes) =>
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),
  // `cwd` is the folder the user picked via the New Terminal dialog. Written
  // onto node.data.cwd so TerminalNode forwards it as the `cwd` prop to
  // TerminalPane — which in turn forwards it as `cwdOverride` to ptySpawn,
  // taking priority over Settings.lastCwd for THIS one pane. The debounced
  // useEffect in TerminalCanvas serializes the new node and round-trips
  // Settings.workspace so the panel survives a restart.
  // The optional `cliId` (a curated CLI id, when bound by a saved layout)
  // seeds the new node's `data.cliId`. The default "+ New terminal" picker
  // path leaves it undefined → `null` here → no auto-launch (raw shell boot,
  // chip strip remains the runtime CLI-choice surface). Only saved layouts
  // ever produce a runtime-auto-launch pane.
  addTerminal: (cwd, cliId) =>
    set((s) => {
      const id = `p${nextPaneId++}`;
      // Cascade each new node down-right of the last so it doesn't sit on top
      // of an existing seed node on first click.
      const last = s.nodes[s.nodes.length - 1];
      const baseX = last ? last.position.x + 60 : 0;
      const baseY = last ? last.position.y + 60 : 0;
      const node: Node = {
        id,
        type: "terminal",
        position: { x: baseX, y: baseY },
        data: { cwd, cliId: cliId ?? null },
        width: NODE_W,
        height: NODE_H,
      };
      return { nodes: [...s.nodes, node] };
    }),
  // See CanvasState.freshPaneId doc — applyLayout re-keys every pane via
  // this primitive so application of a layout unmounts every old pane (React
  // Flow reconciles fresh ids as MOUNTS) + spawns the new layout's panes
  // fresh + auto-launches their cliId. NOT keyed to React render state — the
  // counter is module-scoped at canvas.ts:108.
  freshPaneId: () => `p${nextPaneId++}`,
  removeNode: (id) =>
    set((s) => ({ nodes: s.nodes.filter((n) => n.id !== id) })),
  // Restore the live Node[] from a persisted skeleton. Bumps nextPaneId past
  // any restored id (so the next "+ New terminal" doesn't collide). The store
  // is set wholesale (replace, not merge) so stale pane state can't survive a
  // restore.
  hydrate: (persisted) =>
    set(() => {
      let maxId = 4;
      for (const p of persisted) {
        const m = /^p(\d+)$/.exec(p.paneId);
        if (m) {
          const n = Number(m[1]);
          if (n >= maxId) maxId = n;
        }
      }
      nextPaneId = Math.max(nextPaneId, maxId + 1);
      return { nodes: nodesFromPersist(persisted) };
    }),
  // NOTE: we do NOT recycle deleted ids. The TerminalPane that mounted under
  // this id has already dispatched ptyKill on cleanup; reusing the id would
  // race a fresh spawn against an in-flight kill on the Backend side.
}));

// Test-only reset to the seed state — called by TerminalCanvas.test.tsx
// between tests so module-scope `nextPaneId` doesn't drift across cases.
export function __resetCanvasForTests(): void {
  nextPaneId = 5;
  useCanvasStore.setState({ nodes: defaultSeedNodes() });
}
