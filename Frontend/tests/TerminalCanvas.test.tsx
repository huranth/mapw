// TerminalCanvas — the M2 freeform node surface test (replaces
// TerminalQuad.test.tsx). Mount asserts:
//   (1) the four `pane-*` seed nodes render (one per node);
//   (2) the bridge's ptySpawn fires exactly four times, once per paneId
//       (p1..p4) — React Flow mounts each custom `terminal` node, which wraps
//       one TerminalPane whose mount effect dispatches ptySpawn as before;
//   (3) clicking the "+ New terminal" chip raises alive panes + spawn count
//       to 5 — the canvas store's `addTerminal` seeds a new "p5" node which
//       mounts a 5th TerminalPane → the spawn contract fires once more.
// jsdom has no real layout, so React Flow's drag/pan math isn't driven here;
// we only assert on spawn contract + DOM counts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { makeTestBridge } from "../setupTests";
import {
  DEFAULT_SETTINGS,
  type PtySpawnOptions,
  type PtySpawnResponse,
  type Settings,
} from "@bridgespace/backend/renderer";
import { ThemeProvider } from "@/themes";
import { TerminalCanvas } from "@/components/TerminalCanvas";
import {
  __resetCanvasForTests,
  useCanvasStore,
} from "@/stores/canvas";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  __resetCanvasForTests();
});

function setBridge(bridge: ReturnType<typeof makeTestBridge>): void {
  (window as unknown as { bridge: ReturnType<typeof makeTestBridge> }).bridge =
    bridge;
}

describe("TerminalCanvas", () => {
  it("renders four seed panes", () => {
    setBridge(makeTestBridge());
    render(
      <ThemeProvider>
        <TerminalCanvas />
      </ThemeProvider>,
    );
    expect(screen.getAllByTestId(/^pane-/)).toHaveLength(4);
  });

  it("spawns exactly four PTYs through the bridge, one per paneId", async () => {
    const spawn = vi.fn(
      async (opts: { paneId: string; cols: number; rows: number }) => ({
        paneId: opts.paneId,
        shell: "pwsh",
        cols: opts.cols,
        rows: opts.rows,
        cwd: "/home/test",
      }),
    );
    setBridge(makeTestBridge({ ptySpawn: spawn }));
    render(
      <ThemeProvider>
        <TerminalCanvas />
      </ThemeProvider>,
    );
    await waitFor(() => expect(spawn).toHaveBeenCalledTimes(4));
    const ids = spawn.mock.calls.map((c) => c[0]?.paneId).sort();
    expect(ids).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("clicking + New terminal fires the folder picker + spawns the 5th pane in the picked cwd + persists it as the workspace skeleton", async () => {
    const spawn = vi.fn(
      async (opts: PtySpawnOptions): Promise<PtySpawnResponse> => ({
        paneId: opts.paneId,
        shell: "pwsh",
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwdOverride ?? "/home/test",
      }),
    );
    const updateSettings = vi.fn(
      async (partial: Partial<Settings>) => ({
        settings: { ...DEFAULT_SETTINGS, ...partial },
      }),
    );
    const openDirectoryDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ["/fake/proj"],
    }));
    setBridge(
      makeTestBridge({
        ptySpawn: spawn,
        updateSettings,
        openDirectoryDialog,
      }),
    );
    render(
      <ThemeProvider>
        <TerminalCanvas />
      </ThemeProvider>,
    );
    await waitFor(() => expect(spawn).toHaveBeenCalledTimes(4));
    const add = screen.getByRole("button", { name: /\+ New terminal/i });
    fireEvent.click(add);
    await waitFor(() =>
      expect(openDirectoryDialog).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(spawn).toHaveBeenCalledTimes(5));
    // The picker no longer writes lastCwd — the workspace skeleton carries
    // per-pane cwd now via the debounced TerminalCanvas useEffect. waitFor
    // polling (~50ms) absorbs the 400ms debounce window within its default
    // 1000ms timeout.
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({ paneId: "p5", cwd: "/fake/proj" }),
            ]),
          }),
        }),
      ),
    );
    expect(useCanvasStore.getState().nodes).toHaveLength(5);
    const ids = spawn.mock.calls.map((c) => c[0]?.paneId).sort();
    expect(ids).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    // The 5th spawn must carry the picked folder as cwdOverride; the 4
    // seeds sent no cwdOverride (their data.cwd is undefined and the
    // fallback Settings.lastCwd is null in the default makeTestBridge).
    expect(spawn.mock.calls[4]?.[0]?.cwdOverride).toBe("/fake/proj");
  });
});
