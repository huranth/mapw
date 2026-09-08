import type { PaneNodePersist, SavedLayout } from "@mapw/backend/renderer";
import { seedGridSlots, useCanvasStore } from "@/stores/canvas";
import { useSettingsStore } from "@/stores/settings";
import { useUsageStore } from "@/stores/usage";

const SLOTS_2X2 = seedGridSlots(2, 2);
export const BUILTIN_LAYOUTS: readonly SavedLayout[] = [{ id: "builtin:split-2x2-raw", name: "Split 2×2 raw", builtin: true, nodes: SLOTS_2X2.map((pos, i) => ({ paneId: `p${i + 1}`, cwd: null, position: pos, cliId: null })) }];

export async function applyLayout(layout: SavedLayout): Promise<void> {
  const fallbackCwd = useSettingsStore.getState().settings.lastCwd;
  const nodes: PaneNodePersist[] = layout.nodes.map((n) => ({ paneId: useCanvasStore.getState().freshPaneId(), cwd: n.cwd ?? fallbackCwd, position: n.position, cliId: n.cliId ?? null, size: n.size ?? null }));
  useCanvasStore.getState().hydrate(nodes);
  try { useUsageStore.getState().recordLayout(); useUsageStore.getState().recordTerminal(nodes.length); } catch {}
  await useSettingsStore.getState().update({ workspace: { nodes } });
}

export async function saveCurrentLayout(name: string): Promise<SavedLayout> {
  const nodes = useCanvasStore.getState().nodes.map((n) => ({ paneId: n.id, cwd: (n.data as { cwd?: string | null })?.cwd ?? null, cliId: (n.data as { cliId?: string | null })?.cliId ?? null, position: { x: n.position.x, y: n.position.y }, size: n.width != null && n.height != null ? { width: n.width, height: n.height } : null }));
  const layout: SavedLayout = { id: `usr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name, nodes };
  const cur = useSettingsStore.getState().settings.savedLayouts;
  await useSettingsStore.getState().update({ savedLayouts: [...cur, layout] });
  return layout;
}

export async function renameSavedLayout(id: string, name: string): Promise<void> {
  const cur = useSettingsStore.getState().settings.savedLayouts;
  const next = cur.map((l) => (l.id === id && !l.builtin ? { ...l, name } : l));
  await useSettingsStore.getState().update({ savedLayouts: next });
}

export async function deleteSavedLayout(id: string): Promise<void> {
  const cur = useSettingsStore.getState().settings.savedLayouts;
  const next = cur.filter((l) => !(l.id === id && !l.builtin));
  await useSettingsStore.getState().update({ savedLayouts: next });
}

export function seedLayoutNodes(layout: SavedLayout, fallbackCwd: string | null): PaneNodePersist[] {
  return layout.nodes.map((n) => ({ paneId: n.paneId, cwd: n.cwd ?? fallbackCwd, position: n.position, cliId: n.cliId ?? null, size: n.size ?? null }));
}

function countInOrder(ids: string[]): string[] {
  const counts: Record<string, number> = {};
  const order: string[] = [];
  for (const c of ids) { if (!(c in counts)) order.push(c); counts[c] = (counts[c] ?? 0) + 1; }
  return order.map((id) => (counts[id] === 1 ? id : `${counts[id]}×${id}`));
}

export function summarizeLayout(layout: SavedLayout): string {
  const present = layout.nodes.map((n) => n.cliId).filter((c): c is string => c != null);
  const total = layout.nodes.length;
  if (!present.length) return `${total} panes raw`;
  const parts = countInOrder(present);
  return present.length === total ? `${total} panes ${parts.join(", ")}` : `${total} panes ${parts.join(", ")} and ${total - present.length} raw`;
}
