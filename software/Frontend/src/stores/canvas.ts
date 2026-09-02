import { create } from "zustand";
import { applyNodeChanges, type Node, type OnNodesChange } from "@xyflow/react";
import type { PaneNodePersist } from "@bridgespace/backend/renderer";
import { useUsageStore } from "@/stores/usage";

export const NODE_W = 420;
export const NODE_H = 260;
export const GRID_GAP = 28;

/** Count-aware defaults — keeps single pane spacious, 100 panes still readable. */
export function defaultSizeForCount(count: number): { width: number; height: number; gap: number } {
  if (count <= 1) return { width: 520, height: 300, gap: 28 };
  if (count <= 4) return { width: 420, height: 260, gap: 28 };
  if (count <= 9) return { width: 340, height: 210, gap: 22 };
  if (count <= 25) return { width: 300, height: 180, gap: 18 };
  return { width: 260, height: 155, gap: 16 };
}

export function seedGridSlots(rows: number, cols: number): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: c * (NODE_W + GRID_GAP), y: r * (NODE_H + GRID_GAP) });
  return out;
}

const SEED_SLOTS = seedGridSlots(2, 2);

/** Professional tidy — packs nodes into a compact grid, never called automatically. */
export function tidyLayout(nodes: Node[]): Node[] {
  const n = nodes.length;
  if (n === 0) return nodes;
  const { width: W, height: H, gap: G } = defaultSizeForCount(n);
  const cols = Math.max(2, Math.min(6, Math.ceil(Math.sqrt(n))));
  // stable sort by paneId numeric to keep deterministic
  const sorted = [...nodes].sort((a, b) => {
    const na = Number(/^p(\d+)$/.exec(a.id)?.[1] ?? 0);
    const nb = Number(/^p(\d+)$/.exec(b.id)?.[1] ?? 0);
    return na - nb;
  });
  return sorted.map((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jitterX = (i * 7) % 8;
    const jitterY = (i * 13) % 8;
    return {
      ...node,
      position: { x: col * (W + G) + jitterX, y: row * (H + G) + jitterY },
      width: W,
      height: H,
      measured: { width: W, height: H },
    } as Node;
  });
}

export function seedNodes(cwds: (string | null)[], cliIds?: (string | null)[]): PaneNodePersist[] {
  return [0, 1, 2, 3].map((i) => ({ paneId: `p${i + 1}`, cwd: cwds[i] ?? null, position: SEED_SLOTS[i]!, cliId: cliIds?.[i] ?? null }));
}

export function seedNodesWithCwd(cwd: string | null): PaneNodePersist[] { return seedNodes([cwd, cwd, cwd, cwd]); }

function nodesFromPersist(persisted: PaneNodePersist[]): Node[] {
  return persisted.map((p) => {
    let w = p.size?.width ?? NODE_W;
    let h = p.size?.height ?? NODE_H;
    // migrate old huge defaults (560×320) to new compact defaults — keeps user-moved positions
    if (w === 560 && h === 320) {
      w = NODE_W;
      h = NODE_H;
    } else {
      if (w === 560) w = NODE_W;
      if (h === 320) h = NODE_H;
    }
    // clamp any still-huge persisted size that escaped (e.g., 560+ width from old seed)
    if (w > 600) w = NODE_W;
    if (h > 360) h = NODE_H;
    return { id: p.paneId, type: "terminal", position: p.position, data: { cwd: p.cwd, cliId: p.cliId ?? null }, width: w, height: h };
  });
}

interface CanvasState {
  nodes: Node[];
  nextId: number;
  onNodesChange: OnNodesChange;
  addTerminal: (cwd: string | null, cliId?: string | null) => void;
  removeNode: (id: string) => void;
  hydrate: (persisted: PaneNodePersist[]) => void;
  freshPaneId: () => string;
  tidy: () => void;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  nextId: 5,
  onNodesChange: (changes) => set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),
  addTerminal: (cwd, cliId) => {
    try { useUsageStore.getState().recordTerminal(1); } catch {}
    return set((s) => {
      if (s.nodes.length >= 100) return s; // guard: 100 panes is the tested ceiling
      const id = `p${s.nextId}`;
      const n = s.nodes.length + 1;
      const { width, height, gap } = defaultSizeForCount(n);
      // Grid placement that stays in viewport — not monotonic y like before (y=60*n → 60k at 1000)
      const cols = Math.max(2, Math.min(6, Math.ceil(Math.sqrt(n))));
      const idx = n - 1;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const pos = { x: col * (width + gap), y: row * (height + gap) };
      return { nodes: [...s.nodes, { id, type: "terminal", position: pos, data: { cwd, cliId: cliId ?? null }, width, height } as Node], nextId: s.nextId + 1 };
    });
  },
  freshPaneId: () => {
    let id = "";
    set((s) => {
      id = `p${s.nextId}`;
      return { nextId: s.nextId + 1 };
    });
    return id;
  },
  removeNode: (id) => set((s) => ({ nodes: s.nodes.filter((n) => n.id !== id) })),
  hydrate: (persisted) => {
    const seen = new Set<string>();
    for (const p of persisted) if (seen.has(p.paneId)) throw new Error(`duplicate paneId ${p.paneId}`); else seen.add(p.paneId);
    let max = 4;
    for (const p of persisted) { const m = /^p(\d+)$/.exec(p.paneId); if (m) max = Math.max(max, Number(m[1])); }
    set({ nodes: nodesFromPersist(persisted), nextId: Math.max(get().nextId, max + 1) });
  },
  tidy: () => set((s) => ({ nodes: tidyLayout(s.nodes) })),
}));

export function __resetCanvasForTests(): void {
  useCanvasStore.setState({ nodes: nodesFromPersist(seedNodes([null, null, null, null])), nextId: 5 });
}
