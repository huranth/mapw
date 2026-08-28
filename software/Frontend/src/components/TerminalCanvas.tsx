// TerminalCanvas — the freeform React Flow surface whose nodes are
// <TerminalNode>s wrapping <TerminalPane>. The canvas store owns the node
// list (zustand), hydrated from Settings.workspace by Workspace before this
// canvas mounts; Workspace owns the phase gate ("Continue" vs "Welcome") so
// TerminalCanvas is purely the live paint surface. React Flow drives position
// updates through onNodesChange → applyNodeChanges. No edges, no per-node
// resize, no <Controls>; pan + zoom only. `onInit` runs `fitView()` once so
// the hydrated seed nodes snap in on launch; subsequent drags leave the
// viewport stable. The canvas sits plain #FAFAFA — the hierarchy is whitespace
// + hairlines, not a recessed grid.
//
// Persistence: a debounced useEffect-on-nodes writes the workspace skeleton
// (PaneNodePersist[]) back to Settings.workspace 400ms after the canvas store
// settles — covers add + remove + drag with a single site. The "+ New
// terminal" picker no longer writes lastCwd here; per-pane cwd rides in the
// skeleton. lastCwd is the welcome-flow "primary folder" + TerminalPane
// null-cwd fallback (see Workspace.tsx's commitWelcome) — we don't touch it.

import { useEffect, useRef } from "react";
import {
  Panel,
  ReactFlow,
  type OnInit,
} from "@xyflow/react";
import type { PaneNodePersist } from "@bridgespace/backend/renderer";
import { PlusIcon } from "@/components/Icons";
import { TerminalNode } from "@/components/TerminalNode";
import { useCanvasStore } from "@/stores/canvas";
import { useSettingsStore } from "@/stores/settings";

// Stable map — React Flow memoizes `nodeTypes` and re-creates all node
// components if the object identity changes between renders, so we hoist it
// out of the component body.
const NODE_TYPES = { terminal: TerminalNode } as const;

// Write-back latency for the workspace skeleton serializer. react-flow fires
// onNodesChange every animation frame during a drag, so without a debounce
// the disk + IPC would be hammered ~60Hz (and TerminalPane's focus/blur churn
// might even ride along). 400ms coalesces an entire drag gesture into a
// single persisted write after the user releases the node. The same window
// covers adds/removes with a barely-perceptible delay, well within the
// "session save" feel.
const SKELETON_WRITE_DEBOUNCE_MS = 400;

export function TerminalCanvas() {
  const nodes = useCanvasStore((s) => s.nodes);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const addTerminal = useCanvasStore((s) => s.addTerminal);
  const updateSettings = useSettingsStore((s) => s.update);

  // Ref mirror of the latest serialized skeleton, populated on every
  // debounce-effect fire below. The SEPARATE unmount-flush useEffect further
  // down reads this ref in its cleanup so the skeleton that was in-flight when
  // the canvas unmounts (apply-layout swap, returning -> ready phase
  // transition, app quit) is re-emitted on teardown instead of being dropped
  // with the clearTimeout. React 18 runs cleanups sync, so we can't truly
  // await the IPC round-trip — but the fire-and-forget `void updateSettings`
  // still beats losing the entire pending debounce window on teardown.
  const latestSkeletonRef = useRef<PaneNodePersist[]>([]);

  // Mirror live canvas nodes back to Settings.workspace so "Continue"
  // restores the user's most recent layout after a restart. Persist
  // `{nodes: []}` deliberately — that empty skeleton collapses to "no
  // skeleton" in Workspace's gate (hasNonEmptySkeleton), so the next launch
  // falls back to Welcome, preserving a "clear all" intent. `nodes` is
  // referentially unstable across every onNodesChange (applyNodeChanges
  // returns a new array), so the effect dep fires on every change; the
  // debounce collapses the burst into one disk write.
  useEffect(() => {
    // Mirror the cliId bound to each pane (from a saved layout — see
    // PaneNodePersist.cliId) so the apply-time auto-launch survives an app
    // restart: without this, a pane bound to e.g. `claude` by a layout would
    // lose the binding the next time TerminalCanvas persisted the skeleton
    // (the previous version omitted cliId, and on rehydrate TerminalPane would
    // boot a raw shell with no auto-launch). The cast mirrors the cwd pattern
    // above (`NodeProps.types.data` is `Record<string, unknown>`); the
    // `?? null` coerces missing values to the persist shape.
    const skeleton: PaneNodePersist[] = nodes.map((n) => ({
      paneId: n.id,
      cwd: (n.data?.cwd as string | null) ?? null,
      cliId: (n.data?.cliId as string | null | undefined) ?? null,
      position: { x: n.position.x, y: n.position.y },
      // Persist the live node size so a resized pane restores at its last
      // dragged footprint after a restart. React Flow populates
      // `node.width` / `node.height` on a NodeResizer drag via applyNodeChanges
      // (the `dimensions` change); on the boot seeds (never dragged) these
      // are the canonical NODE_W/NODE_H from canvas.nodesFromPersist, so the
      // skeleton round-trips verbatim. `size` is optional on PaneNodePersist;
      // old settings.json files simply gain the field after the next write.
      size:
        n.width != null && n.height != null
          ? { width: n.width, height: n.height }
          : null,
    }));
    // Cluster 12b — mirror the freshly serialized skeleton into the ref so the
    // unmount-flush useEffect below can re-emit it on teardown. Updated on
    // every effect fire (every onNodesChange burst coalesces via the 400ms
    // debounce; we land the fresh snapshot here before the timer fires).
    latestSkeletonRef.current = skeleton;
    const timer = setTimeout(() => {
      void updateSettings({ workspace: { nodes: skeleton } });
    }, SKELETON_WRITE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [nodes, updateSettings]);

  // Cluster 12b — synchronous unmount-flush. The skeleton above rides a 400ms
  // debounce; if the canvas unmounts before the timer fires (apply-layout
  // swap, returning -> ready phase transition, app quit), the debounce
  // effect's cleanup runs clearTimeout(timer) and the pending write is LOST.
  // This unmount-only useEffect's cleanup reads latestSkeletonRef and
  // re-emits the write so the user's most recent add/drag/resize survives the
  // teardown. The `length > 0` guard avoids emitting an empty skeleton on the
  // FIRST render-before-any-change unmount (which would erase a populated
  // persisted workspace down to "no skeleton" and re-trigger the Welcome
  // gate); the empty case is left to the debounce effect's deliberate empty
  // write when the user explicitly clears the canvas. The dep is just
  // [updateSettings] (stable from zustand) so this mounts once per canvas
  // lifecycle; only its cleanup does any work, while the canvas is alive the
  // debounce effect carries the live write traffic.
  useEffect(() => {
    return () => {
      const skeleton = latestSkeletonRef.current;
      if (skeleton.length > 0) {
        void updateSettings({ workspace: { nodes: skeleton } });
      }
    };
  }, [updateSettings]);

  // The "+ New terminal" chip always opens the native folder picker first
  // (per spec). The picked folder is THIS pane's cwd (written into
  // node.data.cwd via addTerminal → TerminalPane's ptySpawn.cwdOverride).
  // The cwd ride into Settings happens through the debounced skeleton
  // write-back above — the picker here just mutates the canvas store.
  const onNewTerminal = async () => {
    const result = await window.bridge.openDirectoryDialog();
    if (!result || result.canceled || result.filePaths.length === 0) return;
    // filePaths[0] is `string | undefined` under noUncheckedIndexedAccess;
    // the length guard above guarantees a string at runtime, but destructure
    // + narrow so the typechain surfaces the actual click-time cwd without
    // TS2532.
    const [cwd] = result.filePaths;
    if (cwd === undefined) return;
    addTerminal(cwd);
  };

  const handleInit: OnInit = (instance) => {
    instance.fitView({ padding: 0.08 });
  };

  return (
    <div className="canvas" data-testid="terminal-canvas">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onInit={handleInit}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        panOnDrag
        zoomOnScroll
        minZoom={0.2}
        maxZoom={2.5}
      >
        <Panel position="bottom-right">
          <button
            type="button"
            className="canvas__add-chip"
            onClick={onNewTerminal}
          >
            <PlusIcon /> New terminal
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
