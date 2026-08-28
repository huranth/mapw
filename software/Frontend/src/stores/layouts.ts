// BUILTIN_LAYOUTS — built-in layouts the Layouts panel ships ready-to-apply.
// User-saved layouts live separately on `Settings.savedLayouts` (with no
// `builtin` flag); this module's `BUILTIN_LAYOUTS` constant is the curated set
// the panel renders first (Split 2×2 raw + AI pair/trio presets + the
// Six-pane AI grid). All four ship so the user can one-click a multi-CLI
// arrangement instead of manually configuring four+ panes per CLI.
//
// `applyLayout` re-keys every pane with a fresh counter so React Flow
// reconciles them as MOUNTS (not prop-changes on same-id nodes from the prior
// canvas — that would leave mid-TUI panes from the previous layout running
// under the new layout's paneId + repositions them). A fresh id guarantees
// every pane unmounts (TerminalPane cleanup → ptyKill) and a fresh one mounts
// (ptySpawn + auto-launch its cliId if installed).
//
// `saveCurrentLayout` snapshots the live canvas into a user-saved layout:
// `useCanvasStore.getState().nodes` → PaneNodePersist[] (with cliId preserved
// from Node.data.cliId). User saves get a fresh id at save time so they splice
// cleanly into Settings.savedLayouts.
//
// Read-modify-write is the only write path: `SettingsStore.update` is a
// shallow top-level merge, so `update({ savedLayouts: newArr })` REPLACES the
// whole array. `renameSavedLayout` + `deleteSavedLayout` splice client-side
// and write the whole new array back; built-ins (which live as constants
// here, never on the saved array) are immutable and excluded from those
// operations.

import type { PaneNodePersist, SavedLayout } from "@bridgespace/backend/renderer";
import { seedGridSlots, useCanvasStore } from "@/stores/canvas";
import { useSettingsStore } from "@/stores/settings";

// 6 curated CLIs in Backend/src/cli/types.ts — layouts reference them by the
// stable curated id; apply-time TerminalPane looks up the installed CLI to
// resolve the `launchCommand`. Missing-CLIs apply through cleanly (auto-launch
// warns + pane stays raw shell) so a built-in doesn't 404 the user just
// because they're missing one CLI.

function builtin(
  id: string,
  name: string,
  cliIds: readonly (string | null)[],
  positions: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): SavedLayout {
  return {
    id,
    name,
    builtin: true,
    nodes: cliIds.map((cliId, i) => ({
      // Built-in pane ids are layout-stable strings: `p${slot+1}` over the
      // layout's own pane set. applyLayout() re-keys with a fresh counter
      // anyway, so the built-in id is just a placeholder for the snapshot
      // shape. We pick `p{slot+1}` to mirror what a Welcome seed would have
      // produced for the same slot — exports deterministic tests.
      paneId: `p${i + 1}`,
      cwd: null,
      position: positions[i] ?? { x: 0, y: 0 },
      cliId: cliId ?? null,
    })),
  };
}

// 2×2 slot positions for the Split/pair/trio built-ins. `seedSlots` is
// module-private in canvas.ts; `seedGridSlots(2, 2)` is the public helper
// and produces the identical 2×2 in row-major order (top-left first), so the
// pair/trio built-ins reusing SLOTS_2X2[0..N-1] get the same first-row-then-
// second-row order a Welcome-commit 4-pane would have produced.
const SLOTS_2X2 = seedGridSlots(2, 2);

// All four presets, in the order the Layouts panel renders them. The first
// (Split 2×2 raw) mirrors the Welcome flow's commit shape so a user who
// applies it from any other layout gets the boot-default 4-pane raw shell
// back. The AI pair + AI trio use the first N slots of the 2×2 (panes only
// land where cliIds assign slots). The Six-pane AI grid interleaves
// codex/claude/opencode across a 2×3 to match the user's "two terminals with
// X, two with Y, two with Z" example.
export const BUILTIN_LAYOUTS: readonly SavedLayout[] = [
  builtin(
    "builtin:split-2x2-raw",
    "Split 2×2 raw",
    [null, null, null, null],
    SLOTS_2X2,
  ),
  builtin(
    "builtin:pair-codex-claude",
    "AI pair: codex + claude",
    ["codex", "claude"],
    [SLOTS_2X2[0] ?? { x: 0, y: 0 }, SLOTS_2X2[1] ?? { x: 0, y: 0 }],
  ),
  builtin(
    "builtin:trio-codex-claude-opencode",
    "AI trio: codex + claude + opencode",
    ["codex", "claude", "opencode"],
    [
      SLOTS_2X2[0] ?? { x: 0, y: 0 },
      SLOTS_2X2[1] ?? { x: 0, y: 0 },
      SLOTS_2X2[2] ?? { x: 0, y: 0 },
    ],
  ),
  builtin(
    "builtin:grid-6-2x3",
    "Six-pane AI grid 2+2+2",
    ["codex", "claude", "opencode", "codex", "claude", "opencode"],
    seedGridSlots(2, 3),
  ),
];

// Apply a layout (built-in OR user-saved): re-key every pane with a fresh
// counter, resolve null cwds to Settings.lastCwd (so a layout saved in folder
// A applies in folder B with B's lastCwd for the null-cwd panes), then hydrate
// the canvas store — wholesale-replacing the live nodes. React Flow
// reconciles each paneId as a MOUNT (fresh ids) so existing panes unmount
// (TerminalPane cleanup → ptyKill) and the new panes spawn fresh + auto-
// launch their cliId if installed.
//
// Cluster 5 — `size` round-trip: the layout's `node.size` is now carried
// through `applyLayout` (was previously stripped on read — `nodesFromPersist`
// could fall back to the canonical NODE_W/NODE_H for any saved layout's
// resized pane, silently wasting the user's resize). Cluster 12a — sync
// persist: `await settings.update({workspace:{nodes}})` invoked here (after
// the sync `hydrate`) blocks this function's Promise on Settings.json's
// atomic-rename write, so by the time the panel closes + the canvas mounts,
// the on-disk state already mirrors the live canvas. Previously the only
// persist path was TerminalCanvas's 400 ms-debounced skeleton write-back — a
// quit (or another apply, or a drag) inside that window would land a stale
// `workspace.nodes` on pre-apply snapshot → on the next launch Continue
// hydrates the stale snapshot → the apply silently vanished.
export async function applyLayout(layout: SavedLayout): Promise<void> {
  const fallbackCwd = useSettingsStore.getState().settings.lastCwd;
  const freshPaneIds = layout.nodes.map(() =>
    useCanvasStore.getState().freshPaneId(),
  );
  const nodes: PaneNodePersist[] = layout.nodes.map((node, i) => ({
    paneId: freshPaneIds[i] ?? "p0",
    cwd: node.cwd ?? fallbackCwd,
    position: node.position,
    cliId: node.cliId ?? null,
    // Cluster 5 — preserve the saved layout's `size` so a resized pane
    // restores at its last dragged footprint (mirrors the read side's
    // `nodesFromPersist` which now consults `p.size`). `?? null` keeps the
    // optional-field contract: missing/absent on built-ins + pre-feature
    // layouts, present on any pane that the user dragged-to-resize before
    // saving. The serializer in TerminalCanvas.tsx:80-83 carries the SAME
    // field on the live skeleton round-trip; this fix closes the saved-
    // layout's symmetric drop.
    size: node.size ?? null,
  }));
  // Hydrate FIRST so the canvas mounts with the new panes immediately on
  // the next render — `setPhase("ready")` after this await will rerender
  // Workspace (now `phase === "ready"`) and `<TerminalCanvas/>` mounts with
  // the freshly-hydrated nodes from the canvas store.
  useCanvasStore.getState().hydrate(nodes);
  await useSettingsStore.getState().update({ workspace: { nodes } });
}

// Snapshot the live canvas as a named layout. Reads
// `useCanvasStore.getState().nodes` → PaneNodePersist[] (carrying cliId from
// Node.data.cliId so a layout saved from an applied-then-modified canvas
// preserves the CLI bindings). Writes via the existing
// `useSettingsStore.update({ savedLayouts })` path — the update replaces the
// whole savedLayouts array (shallow merge on SettingsStore.update). Returns
// the saved layout so LayoutsScreen can show it immediately without waiting
// for the store's async round-trip.
export async function saveCurrentLayout(name: string): Promise<SavedLayout> {
  const nodes = useCanvasStore.getState().nodes;
  const persistNodes: PaneNodePersist[] = nodes.map((n) => ({
    paneId: n.id,
    cwd: (n.data?.cwd as string | null | undefined) ?? null,
    cliId: (n.data?.cliId as string | null | undefined) ?? null,
    position: { x: n.position.x, y: n.position.y },
    // Cluster 5 — symmetric write side of the `size` round-trip. Reads the
    // live React Flow node's top-level `width` / `height` (populated by
    // <NodeResizer>'s `dimensions` change via applyNodeChanges) and persists
    // them as `PaneNodePersist.size`, so a layout saved from a resized pane
    // applies at its last dragged footprint via `applyLayout`'s
    // `node.size ?? null` above. The previous version omitted this — saving
    // + re-applying silently lost every resize (panes snapped back to
    // NODE_W×NODE_H = 560×320 each). Mirrors the live skeleton serializer in
    // TerminalCanvas.tsx:80-83 verbatim so both write paths agree.
    size:
      n.width != null && n.height != null
        ? { width: n.width, height: n.height }
        : null,
  }));
  // Fresh id prevents collisions across saves done close in time. Date.now()
  // + Math.random base36 is unique enough for one user's local settings.json
  // (this isn't a shared-server id — settings.json holds one user's data on
  // one machine). The `usr-` prefix reads cleanly in a settings.json peek.
  const layout: SavedLayout = {
    id: `usr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    nodes: persistNodes,
  };
  const cur = useSettingsStore.getState().settings.savedLayouts;
  const next = [...cur, layout];
  await useSettingsStore.getState().update({ savedLayouts: next });
  return layout;
}

// Rename a user-saved layout by id. Built-ins are immutable — LayoutsScreen
// doesn't render rename affordances for layouts with `builtin: true`, and
// renameSavedLayout no-ops on entries whose `builtin` flag is set (defensive
// — built-in ids carry the `builtin:...` prefix and never actually live on
// the savedLayouts array, but the no-op guard documents intent + matches the
// deleteSavedLayout symmetric treatment).
export async function renameSavedLayout(
  id: string,
  name: string,
): Promise<void> {
  const cur = useSettingsStore.getState().settings.savedLayouts;
  const next = cur.map((l) =>
    l.id === id && !l.builtin ? { ...l, name } : l,
  );
  await useSettingsStore.getState().update({ savedLayouts: next });
}

// Delete a user-saved layout by id. Same builtin guard — no-op if the id isn't
// found or matches a builtin (which shouldn't appear on savedLayouts).
export async function deleteSavedLayout(id: string): Promise<void> {
  const cur = useSettingsStore.getState().settings.savedLayouts;
  const next = cur.filter((l) => !(l.id === id && !l.builtin));
  await useSettingsStore.getState().update({ savedLayouts: next });
}

// Pure helper for previewing layouts (or for tests): feed a layout's nodes + a
// fallback cwd, yield PaneNodePersist[] with every null cwd filled in. Does
// NOT re-key — returns the layout's paneIds verbatim.
export function seedLayoutNodes(
  layout: SavedLayout,
  fallbackCwd: string | null,
): PaneNodePersist[] {
  return layout.nodes.map((node) => ({
    paneId: node.paneId,
    cwd: node.cwd ?? fallbackCwd,
    position: node.position,
    cliId: node.cliId ?? null,
    // Cluster 5 — symmetric carry of layout's `node.size` through the
    // preview/test helper so a layout's resized-footprint survives the
    // pure-helper path too (parity with `applyLayout`'s `node.size ?? null`).
    size: node.size ?? null,
  }));
}

// Pure helper for summary rendering (or for tests): count the pane/cli
// breakdown (e.g. "6 panes — 2×codex · 2×claude · 2×opencode"). Used by the
// LayoutsScreen card + row to summarise each layout without coupling to the
// UI's structure, and by the test suite to assert the built-in shape.
export function summarizeLayout(layout: SavedLayout): string {
  const cliIds = layout.nodes.map((n) => n.cliId ?? null);
  const present = cliIds.filter((c): c is string => c != null);
  const total = layout.nodes.length;

  // Count duplicates preserving insertion order (so the layout's design
  // order — codex, claude, opencode for the six-grid — survives the summary).
  const countInOrder = (ids: string[]): string[] => {
    const counts: Record<string, number> = {};
    const order: string[] = [];
    for (const c of ids) {
      if (!(c in counts)) order.push(c);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return order.map((id) => (counts[id] === 1 ? id : `${counts[id]}×${id}`));
  };

  if (present.length === 0) {
    return `${total} panes — raw shell`;
  }
  if (present.length === total) {
    return `${total} panes — ${countInOrder(present).join(" · ")}`;
  }
  const rawCount = total - present.length;
  const rawPart = rawCount === 1 ? "1 raw" : `${rawCount} raw`;
  return `${total} panes — ${countInOrder(present).join(" · ")} + ${rawPart}`;
}
