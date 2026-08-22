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

import { useEffect } from "react";
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

  // Mirror live canvas nodes back to Settings.workspace so "Continue"
  // restores the user's most recent layout after a restart. Persist
  // `{nodes: []}` deliberately — that empty skeleton collapses to "no
  // skeleton" in Workspace's gate (hasNonEmptySkeleton), so the next launch
  // falls back to Welcome, preserving a "clear all" intent. `nodes` is
  // referentially unstable across every onNodesChange (applyNodeChanges
  // returns a new array), so the effect dep fires on every change; the
  // debounce collapses the burst into one disk write.
  useEffect(() => {
    const skeleton: PaneNodePersist[] = nodes.map((n) => ({
      paneId: n.id,
      cwd: (n.data?.cwd as string | null) ?? null,
      position: { x: n.position.x, y: n.position.y },
    }));
    const timer = setTimeout(() => {
      void updateSettings({ workspace: { nodes: skeleton } });
    }, SKELETON_WRITE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [nodes, updateSettings]);

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
            <PlusIcon /> + New terminal
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
