import { useCallback, useEffect, useRef } from "react";
import { MiniMap, Panel, ReactFlow, type OnInit, type ReactFlowInstance } from "@xyflow/react";
import type { PaneNodePersist } from "@mapw/backend/renderer";
import { LayoutGridIcon, PlusIcon } from "@/components/Icons";
import { TerminalNode } from "@/components/TerminalNode";
import { NODE_H, NODE_W, useCanvasStore } from "@/stores/canvas";
import { useSettingsStore } from "@/stores/settings";

const NODE_TYPES = { terminal: TerminalNode } as const;
const SKELETON_WRITE_DEBOUNCE_MS = 400;

export function TerminalCanvas() {
  const nodes = useCanvasStore((s) => s.nodes);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const addTerminal = useCanvasStore((s) => s.addTerminal);
  const tidy = useCanvasStore((s) => s.tidy);
  const updateSettings = useSettingsStore((s) => s.update);
  const latestSkeletonRef = useRef<PaneNodePersist[]>([]);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const lastMoveRef = useRef<number>(Date.now());
  const prevCountRef = useRef<number>(nodes.length);

  // Migrate old
  useEffect(() => {
    const cur = useCanvasStore.getState().nodes;
    const big = cur.some((n) => (n.width ?? 0) > 600 || (n.height ?? 0) > 360);
    if (!big) return;
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n) => {
        if ((n.width ?? 0) > 600 || (n.height ?? 0) > 360) {
          return { ...n, width: NODE_W, height: NODE_H, measured: { width: NODE_W, height: NODE_H } } as typeof n;
        }
        return n;
      }),
    }));
  }, []);

  useEffect(() => {
    const skeleton: PaneNodePersist[] = nodes.map((n) => ({
      paneId: n.id,
      cwd: (n.data?.cwd as string | null) ?? null,
      cliId: (n.data?.cliId as string | null | undefined) ?? null,
      position: { x: n.position.x, y: n.position.y },
      size: n.width != null && n.height != null ? { width: n.width, height: n.height } : null,
    }));
    latestSkeletonRef.current = skeleton;
    const timer = setTimeout(() => { void updateSettings({ workspace: { nodes: skeleton } }); }, SKELETON_WRITE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [nodes, updateSettings]);

  useEffect(() => {
    return () => {
      const skeleton = latestSkeletonRef.current;
      if (skeleton.length > 0) void updateSettings({ workspace: { nodes: skeleton } });
    };
  }, [updateSettings]);

  // Idle gated
  useEffect(() => {
    const prev = prevCountRef.current;
    const cur = nodes.length;
    prevCountRef.current = cur;
    if (cur === prev || cur === 0) return;
    if (Date.now() - lastMoveRef.current < 2000) return;
    const rf = rfRef.current;
    if (!rf) return;
    const padding = Math.max(0.18, Math.min(0.32, 0.18 + cur * 0.004));
    const maxZoom = cur <= 4 ? 1 : cur <= 25 ? 1.05 : 0.9;
    // Small delay
    const t = window.setTimeout(() => rf.fitView({ padding, maxZoom, duration: 280 }), 80);
    return () => window.clearTimeout(t);
  }, [nodes.length]);

  const onNewTerminal = async () => {
    const result = await window.bridge.openDirectoryDialog();
    if (!result || result.canceled || result.filePaths.length === 0) return;
    const [cwd] = result.filePaths;
    if (cwd === undefined) return;
    addTerminal(cwd);
  };

  const onTidy = useCallback(() => {
    tidy();
    // fit after tidy
    window.setTimeout(() => {
      const rf = rfRef.current;
      if (!rf) return;
      const n = useCanvasStore.getState().nodes.length;
      const padding = Math.max(0.18, Math.min(0.32, 0.18 + n * 0.004));
      rf.fitView({ padding, maxZoom: 1, duration: 260 });
    }, 60);
  }, [tidy]);

  const handleInit: OnInit = (instance) => {
    rfRef.current = instance;
    const n = useCanvasStore.getState().nodes.length || 1;
    const padding = n === 1 ? 0.1 : 0.22;
    const maxZoom = n === 1 ? 1.35 : 1;
    instance.fitView({ padding, maxZoom });
  };

  const handleMoveStart = useCallback(() => {
    lastMoveRef.current = Date.now();
  }, []);

  const showMiniMap = nodes.length > 12;
  const virtualize = nodes.length > 25;

  return (
    <div className="canvas" data-testid="terminal-canvas">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onInit={handleInit}
        onMoveStart={handleMoveStart}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        panOnDrag
        zoomOnScroll
        minZoom={0.2}
        maxZoom={2.5}
        onlyRenderVisibleElements={virtualize}
      >
        {showMiniMap ? (
          <MiniMap
            pannable
            zoomable
            style={{ background: "#FFFDFA", border: "1px solid #E8E2D6", borderRadius: 8 }}
            maskColor="rgba(28,25,23,0.08)"
          />
        ) : null}
        <Panel position="bottom-right" style={{ display: "flex", gap: 8 }}>
          <button type="button" className="canvas__tidy-chip" onClick={onTidy} aria-label="Tidy layout" title="Tidy — arrange panes in a clean grid (keeps your drags until you click)">
            <LayoutGridIcon size={12} style={{ marginRight: 6 }} />Tidy
          </button>
          <button type="button" className="canvas__add-chip" onClick={onNewTerminal}>
            <PlusIcon size={12} style={{ marginRight: 6, color: "#FFF" }} />
            New terminal
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}