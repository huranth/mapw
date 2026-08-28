// canvas store — exercises the cliId-threading additions: seedNodes now
// carries parallel cliIds into PaneNodePersist; seedGridSlots produces
// non-2×2 layouts (the Six-pane AI grid uses 2×3); addTerminal stamps cliId
// onto the new node's data so a saved layout's panes survive a save cycle;
// nodesFromPersist (the inverse of TerminalCanvas's debounced serialize)
// round-trips cliId; freshPaneId mints the unique sequential counter
// layouts.applyLayout seeds pane re-keying from.

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCanvasForTests,
  GRID_GAP,
  NODE_H,
  NODE_W,
  seedGridSlots,
  seedNodes,
  useCanvasStore,
} from "@/stores/canvas";

beforeEach(() => {
  __resetCanvasForTests();
});

describe("canvas store — cliId threading", () => {
  it("seedNodes carries parallel cliIds into PaneNodePersist", () => {
    const nodes = seedNodes(
      [null, null, null, null],
      ["codex", "claude", null, null],
    );
    expect(nodes).toHaveLength(4);
    expect(nodes[0]?.cliId).toBe("codex");
    expect(nodes[1]?.cliId).toBe("claude");
    expect(nodes[2]?.cliId).toBeNull(); // null = raw-shell boot
    expect(nodes[3]?.cliId).toBeNull();
  });

  it("seedNodes without cliIds falls back to null (back-compat for the existing Welcome commit)", () => {
    const nodes = seedNodes([null, null, null, null]);
    expect(nodes).toHaveLength(4);
    for (const n of nodes) {
      expect(n.cliId).toBeNull();
    }
  });

  it("seedGridSlots(2, 3) produces a 2×3 grid at the NODE_W + GRID_GAP column pitch + NODE_H + GRID_GAP row pitch", () => {
    const slots = seedGridSlots(2, 3);
    expect(slots).toHaveLength(6);
    // top-left
    expect(slots[0]).toEqual({ x: 0, y: 0 });
    // top-right (row 0 col 2)
    expect(slots[2]).toEqual({
      x: 2 * (NODE_W + GRID_GAP),
      y: 0,
    });
    // bottom-left (row 1 col 0)
    expect(slots[3]).toEqual({
      x: 0,
      y: 1 * (NODE_H + GRID_GAP),
    });
    // bottom-right (row 1 col 2)
    expect(slots[5]).toEqual({
      x: 2 * (NODE_W + GRID_GAP),
      y: 1 * (NODE_H + GRID_GAP),
    });
  });

  it("addTerminal(cwd, cliId) stamps cliId onto the new node's data", () => {
    useCanvasStore.getState().addTerminal(null, "opencode");
    const nodes = useCanvasStore.getState().nodes;
    const last = nodes[nodes.length - 1];
    expect(last?.data).toMatchObject({ cwd: null, cliId: "opencode" });
  });

  it("addTerminal falls back to cliId=null when cliId is omitted", () => {
    useCanvasStore.getState().addTerminal("/home/test");
    const nodes = useCanvasStore.getState().nodes;
    const last = nodes[nodes.length - 1];
    expect(last?.data).toMatchObject({ cwd: "/home/test", cliId: null });
  });

  it("hydrate round-trips cliId through nodesFromPersist (the inverse of the debounced serialize)", () => {
    useCanvasStore.getState().hydrate([
      {
        paneId: "p-alpha",
        cwd: null,
        position: { x: 0, y: 0 },
        cliId: "codex",
      },
      {
        paneId: "p-beta",
        cwd: "/some/path",
        position: { x: 100, y: 0 },
        cliId: null,
      },
    ]);
    const nodes = useCanvasStore.getState().nodes;
    expect(nodes[0]?.data).toMatchObject({ cliId: "codex" });
    expect(nodes[1]?.data).toMatchObject({ cliId: null });
  });

  it("freshPaneId mints sequential unique ids starting at p5 after the boot-seed reset (no reuse across apply cycles)", () => {
    // Reset bumps nextPaneId to 5 (past the 4 boot seeds).
    const a = useCanvasStore.getState().freshPaneId();
    const b = useCanvasStore.getState().freshPaneId();
    const c = useCanvasStore.getState().freshPaneId();
    expect(a).toBe("p5");
    expect(b).toBe("p6");
    expect(c).toBe("p7");
  });
});
