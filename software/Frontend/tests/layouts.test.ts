// layouts.ts — built-in presets + apply/save/rename/delete + summary helper.
// Saves/renames/deletes proxy the call through useSettingsStore.update, so
// tests mock `update` via installBridge + a vi.fn update. apply() directly
// touches useCanvasStore.hydrate + .freshPaneId; tests just observe the store
// state change (no spying required since the store is observable via
// getState()). No React render — pure state + bridge exercises.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  type SavedLayout,
  type Settings,
} from "@bridgespace/backend/renderer";
import type { Bridge, GetSettingsResponse } from "@/bridge/types";
import { makeTestBridge } from "../setupTests";
import {
  BUILTIN_LAYOUTS,
  applyLayout,
  deleteSavedLayout,
  renameSavedLayout,
  saveCurrentLayout,
  seedLayoutNodes,
  summarizeLayout,
} from "@/stores/layouts";
import { __resetCanvasForTests, useCanvasStore } from "@/stores/canvas";
import { useSettingsStore } from "@/stores/settings";

function installBridge(overrides: Partial<Bridge> = {}): Bridge {
  const full = makeTestBridge(overrides);
  (window as unknown as { bridge: Bridge }).bridge = full;
  return full;
}

beforeEach(() => {
  __resetCanvasForTests();
  installBridge({});
  // Reset settings store to DEFAULT after each test so savedLayouts starts
  // empty + the next test's assertions are independent.
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS },
    loaded: true,
  });
});

describe("BUILTIN_LAYOUTS", () => {
  it("ships exactly the four curated built-ins in spec order with stable ids", () => {
    expect(BUILTIN_LAYOUTS).toHaveLength(4);
    const ids = BUILTIN_LAYOUTS.map((b) => b.id);
    expect(ids).toEqual([
      "builtin:split-2x2-raw",
      "builtin:pair-codex-claude",
      "builtin:trio-codex-claude-opencode",
      "builtin:grid-6-2x3",
    ]);
  });

  it("every built-in carries builtin: true + the expected pane/cli mix", () => {
    for (const b of BUILTIN_LAYOUTS) {
      expect(b.builtin).toBe(true);
    }

    // Split 2×2 raw — 4 panes, all cliId null.
    const split = BUILTIN_LAYOUTS[0]!;
    expect(split.nodes).toHaveLength(4);
    expect(split.nodes.every((n) => n.cliId == null)).toBe(true);

    // AI pair — 2 panes: codex + claude.
    const pair = BUILTIN_LAYOUTS[1]!;
    expect(pair.nodes).toHaveLength(2);
    expect(pair.nodes[0]?.cliId).toBe("codex");
    expect(pair.nodes[1]?.cliId).toBe("claude");

    // AI trio — 3 panes: codex + claude + opencode.
    const trio = BUILTIN_LAYOUTS[2]!;
    expect(trio.nodes).toHaveLength(3);
    expect(trio.nodes[0]?.cliId).toBe("codex");
    expect(trio.nodes[1]?.cliId).toBe("claude");
    expect(trio.nodes[2]?.cliId).toBe("opencode");

    // Six-pane AI grid — 6 panes, two each of codex/claude/opencode, matching
    // the user's "layout X" example (two terminals with X, two with Y, two
    // with Z) verbatim.
    const grid = BUILTIN_LAYOUTS[3]!;
    expect(grid.nodes).toHaveLength(6);
    expect(grid.nodes.map((n) => n.cliId)).toEqual([
      "codex",
      "claude",
      "opencode",
      "codex",
      "claude",
      "opencode",
    ]);
  });
});

describe("summarizeLayout", () => {
  it("renders 'raw shell' summary for a layout with no bound CLIs", () => {
    expect(summarizeLayout(BUILTIN_LAYOUTS[0]!)).toMatch(
      /4 panes — raw shell/,
    );
  });

  it("renders distinct names when every pane has a distinct cliId", () => {
    expect(summarizeLayout(BUILTIN_LAYOUTS[2]!)).toBe(
      "3 panes — codex · claude · opencode",
    );
  });

  it("collapses duplicates into a count form (the user's layout-X example: 2×codex + 2×claude + 2×opencode)", () => {
    expect(summarizeLayout(BUILTIN_LAYOUTS[3]!)).toBe(
      "6 panes — 2×codex · 2×claude · 2×opencode",
    );
  });
});

describe("seedLayoutNodes", () => {
  it("substitutes null cwds with the fallback, preserves explicit cwd + cliId + paneId + position", () => {
    const layout: SavedLayout = {
      id: "test-layout",
      name: "Test",
      nodes: [
        {
          paneId: "p1",
          cwd: null,
          position: { x: 0, y: 0 },
          cliId: "codex",
        },
        {
          paneId: "p2",
          cwd: "/explicit/path",
          position: { x: 100, y: 0 },
          cliId: null,
        },
      ],
    };
    const out = seedLayoutNodes(layout, "/fallback/path");
    expect(out).toEqual([
      {
        paneId: "p1",
        cwd: "/fallback/path", // null swapped for fallback
        position: { x: 0, y: 0 },
        cliId: "codex",
        // Cluster 5 — seedLayoutNodes now propagates `size` from the layout's
        // node entries (persisted NodeResizer footprint the user dragged into
        // a saved layout): pass-through when present, else null. The built-in
        // preset above omits `size` on every pane → null here.
        size: null,
      },
      {
        paneId: "p2",
        cwd: "/explicit/path", // explicit cwd preserved
        position: { x: 100, y: 0 },
        cliId: null,
        size: null,
      },
    ]);
  });
});

describe("applyLayout", () => {
  it("wholesale-replaces the canvas store with the layout's panes re-keyed via freshPaneId (so React Flow reconciles them as mounts)", () => {
    // Reset bumps nextPaneId to 5 — past the 4 boot seeds.
    applyLayout(BUILTIN_LAYOUTS[1]!); // AI pair (2 panes)
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes).toHaveLength(2);
    // PaneIds are fresh (p5, p6) — never reused from the 4 boot seeds, so
    // React Flow reconciles them as MOUNTS, not prop-changes on existing
    // p1/p2 nodes (which would leave mid-TUI panes running under the new
    // layout's positions).
    expect(nodes[0]?.id).toBe("p5");
    expect(nodes[1]?.id).toBe("p6");
    // cliId bindings carried from the layout (codex in slot 0, claude in slot 1).
    expect(nodes[0]?.data).toMatchObject({ cliId: "codex" });
    expect(nodes[1]?.data).toMatchObject({ cliId: "claude" });
  });

  it("falls back to Settings.lastCwd when a layout pane has cwd=null", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, lastCwd: "/my/workspace" },
      loaded: true,
    });
    applyLayout(BUILTIN_LAYOUTS[0]!); // Split 2×2 raw — all cwds null
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes).toHaveLength(4);
    for (const n of nodes) {
      expect(n.data).toMatchObject({ cwd: "/my/workspace" });
    }
  });
});

describe("saveCurrentLayout", () => {
  it("snapshots the live canvas via useCanvasStore.state.nodes and writes SavedLayout into Settings.savedLayouts via the read-modify-write path", async () => {
    // Seed the canvas with a 2-pane sample carrying cliId.
    useCanvasStore.setState({
      nodes: [
        {
          id: "real-p1",
          type: "terminal",
          position: { x: 0, y: 0 },
          data: { cwd: "/path/a", cliId: "codex" },
          width: 560,
          height: 320,
        },
        {
          id: "real-p2",
          type: "terminal",
          position: { x: 596, y: 0 },
          data: { cwd: null, cliId: "claude" },
          width: 560,
          height: 320,
        },
      ],
    });

    const updateSettings = vi.fn(
      async (partial: Partial<Settings>): Promise<GetSettingsResponse> => ({
        settings: { ...DEFAULT_SETTINGS, ...partial },
      }),
    );
    installBridge({ updateSettings });

    const saved = await saveCurrentLayout("My layout");
    expect(saved.name).toBe("My layout");
    expect(saved.nodes).toHaveLength(2);
    expect(saved.nodes[0]?.paneId).toBe("real-p1");
    expect(saved.nodes[0]?.cwd).toBe("/path/a");
    expect(saved.nodes[0]?.cliId).toBe("codex");
    expect(saved.nodes[1]?.paneId).toBe("real-p2");
    expect(saved.nodes[1]?.cwd).toBeNull();
    expect(saved.nodes[1]?.cliId).toBe("claude");

    expect(updateSettings).toHaveBeenCalledTimes(1);
    const arg = updateSettings.mock.calls[0]?.[0] as Partial<Settings>;
    expect(arg).toHaveProperty("savedLayouts");
    // The save appended the new layout (read-modify-write preserves any
    // existing entries + appends the new one — here the existing array was
    // empty so the saved array holds exactly the one new entry).
    const savedArr = arg.savedLayouts as SavedLayout[];
    expect(savedArr).toHaveLength(1);
    expect(savedArr[0]?.name).toBe("My layout");
    expect(savedArr[0]?.nodes).toHaveLength(2);
  });
});

describe("renameSavedLayout", () => {
  it("splices the new name into the matching user-saved entry; built-ins are immune", async () => {
    const existing: SavedLayout = {
      id: "usr-existing",
      name: "Old name",
      nodes: [
        { paneId: "p1", cwd: null, position: { x: 0, y: 0 }, cliId: null },
      ],
    };
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, savedLayouts: [existing] },
      loaded: true,
    });
    const updateSettings = vi.fn(
      async (partial: Partial<Settings>): Promise<GetSettingsResponse> => ({
        settings: { ...DEFAULT_SETTINGS, ...partial },
      }),
    );
    installBridge({ updateSettings });

    await renameSavedLayout("usr-existing", "New name");
    const arg1 = updateSettings.mock.calls[0]?.[0] as {
      savedLayouts: SavedLayout[];
    };
    expect(arg1.savedLayouts[0]?.name).toBe("New name");

    // A rename against a builtin id is a no-op — the guard's
    // `!l.builtin` clause keeps any entry of a non-builtin id immutable
    // (defensive against a synthesized `builtin:...` id landing on the
    // saved array, which the LayoutsScreen itself never does).
    updateSettings.mockClear();
    await renameSavedLayout("builtin:split-2x2-raw", "hijack attempt");
    expect(updateSettings).toHaveBeenCalledTimes(1);
    const argNoop = updateSettings.mock.calls[0]?.[0] as {
      savedLayouts: SavedLayout[];
    };
    // Builtin id wasn't found in the saved array → entry untouched.
    expect(argNoop.savedLayouts[0]?.name).toBe("New name");
  });
});

describe("deleteSavedLayout", () => {
  it("removes the matching user-saved entry; built-ins are immune", async () => {
    const a: SavedLayout = {
      id: "usr-a",
      name: "A",
      nodes: [
        { paneId: "p1", cwd: null, position: { x: 0, y: 0 }, cliId: null },
      ],
    };
    const b: SavedLayout = {
      id: "usr-b",
      name: "B",
      nodes: [
        { paneId: "p2", cwd: null, position: { x: 1, y: 0 }, cliId: null },
      ],
    };
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, savedLayouts: [a, b] },
      loaded: true,
    });
    const updateSettings = vi.fn(
      async (partial: Partial<Settings>): Promise<GetSettingsResponse> => ({
        settings: { ...DEFAULT_SETTINGS, ...partial },
      }),
    );
    installBridge({ updateSettings });

    await deleteSavedLayout("usr-a");
    const arg = updateSettings.mock.calls[0]?.[0] as {
      savedLayouts: SavedLayout[];
    };
    expect(arg.savedLayouts).toHaveLength(1);
    expect(arg.savedLayouts[0]?.id).toBe("usr-b");
  });
});
