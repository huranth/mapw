// LayoutsScreen — built-ins render; Apply button fires onApply with the
// picked layout; missing-CLI badge appears when a referenced CLI isn't
// installed; saved-layout rows render with Apply/Rename/Delete chips; Delete
// calls deleteSavedLayout (via the layouts.ts helper, which proxies through
// useSettingsStore.update → window.bridge.updateSettings); Save current
// canvas creates a new saved layout; Rename commits on Enter. LayoutsScreen
// reads via zustand selectors from useSettingsStore + useCliToolsStore +
// useCanvasStore — seeding via setState feeds the values without needing
// React providers for those stores.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  DEFAULT_SETTINGS,
  type DetectedCliTool,
  type SavedLayout,
  type Settings,
} from "@bridgespace/backend/renderer";
import type { Bridge, GetSettingsResponse } from "@/bridge/types";
import { makeTestBridge } from "../setupTests";
import { LayoutsScreen } from "@/components/LayoutsScreen";
import { __resetCanvasForTests, useCanvasStore } from "@/stores/canvas";
import { useCliToolsStore } from "@/stores/cliTools";
import { useSettingsStore } from "@/stores/settings";

const sampleDetected: DetectedCliTool[] = [
  {
    id: "codex",
    name: "codex",
    binary: "codex",
    launchCommand: "codex",
    path: "/usr/local/bin/codex",
  },
  {
    id: "opencode",
    name: "opencode",
    binary: "opencode",
    launchCommand: "opencode",
    path: "/usr/local/bin/opencode",
  },
];

function installBridge(overrides: Partial<Bridge> = {}): Bridge {
  const full = makeTestBridge(overrides);
  (window as unknown as { bridge: Bridge }).bridge = full;
  return full;
}

beforeEach(() => {
  __resetCanvasForTests();
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS },
    loaded: true,
  });
  useCliToolsStore.setState({ cliTools: [], loaded: true });
  installBridge({});
});

afterEach(() => {
  cleanup();
  useCliToolsStore.setState({ cliTools: [], loaded: false });
});

describe("LayoutsScreen — built-in section", () => {
  it("renders the single built-in preset with its name + summary", () => {
    render(<LayoutsScreen onApply={vi.fn()} onClose={vi.fn()} />);
    const card = screen.getByTestId("layouts-builtin-builtin:split-2x2-raw");
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent("Split 2×2 raw");
    expect(card).toHaveTextContent("4 panes — raw shell");
  });

  it("shows the missing-CLI badge on a saved layout referencing CLIs that aren't installed", () => {
    // Only codex installed — claude + opencode missing.
    useCliToolsStore.setState({
      cliTools: [sampleDetected[0]!],
      loaded: true,
    });
    const saved: SavedLayout = {
      id: "usr-missing",
      name: "Missing",
      nodes: [
        { paneId: "p1", cwd: null, position: { x: 0, y: 0 }, cliId: "codex" },
        { paneId: "p2", cwd: null, position: { x: 100, y: 0 }, cliId: "claude" },
        {
          paneId: "p3",
          cwd: null,
          position: { x: 200, y: 0 },
          cliId: "opencode",
        },
      ],
    };
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, savedLayouts: [saved] },
      loaded: true,
    });
    render(<LayoutsScreen onApply={vi.fn()} onClose={vi.fn()} />);
    const row = screen.getByTestId("layouts-saved-usr-missing");
    // The row references codex + claude + opencode; only codex is installed
    // here → badge shows the missing pair in insertion order, dedup'd.
    expect(row).toHaveTextContent(/missing: claude, opencode/);
  });

  it("Apply on the built-in card fires onApply with that built-in layout", () => {
    const onApply = vi.fn();
    render(<LayoutsScreen onApply={onApply} onClose={vi.fn()} />);
    fireEvent.click(
      screen.getByTestId("layouts-apply-builtin-builtin:split-2x2-raw"),
    );
    expect(onApply).toHaveBeenCalledTimes(1);
    const layout = onApply.mock.calls[0]?.[0] as SavedLayout;
    expect(layout.id).toBe("builtin:split-2x2-raw");
    expect(layout.nodes).toHaveLength(4);
    expect(layout.nodes.every((n) => n.cliId == null)).toBe(true);
  });
});

describe("LayoutsScreen — saved layouts section", () => {
  it("shows the empty hint when there are no saved layouts", () => {
    render(<LayoutsScreen onApply={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/No saved layouts yet./i)).toBeInTheDocument();
  });

  it("renders a row per saved layout with name + Apply + Rename + Delete chips", () => {
    const sample: SavedLayout = {
      id: "usr-sample",
      name: "Sample",
      nodes: [
        {
          paneId: "p1",
          cwd: null,
          position: { x: 0, y: 0 },
          cliId: "codex",
        },
      ],
    };
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, savedLayouts: [sample] },
      loaded: true,
    });
    render(<LayoutsScreen onApply={vi.fn()} onClose={vi.fn()} />);
    expect(
      screen.getByTestId("layouts-saved-usr-sample"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("layouts-apply-saved-usr-sample"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("layouts-rename-go-usr-sample"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("layouts-delete-usr-sample"),
    ).toBeInTheDocument();
  });

  it("Delete calls deleteSavedLayout + the settings store drops the entry", async () => {
    const sample: SavedLayout = {
      id: "usr-sample",
      name: "Sample",
      nodes: [
        {
          paneId: "p1",
          cwd: null,
          position: { x: 0, y: 0 },
          cliId: "codex",
        },
      ],
    };
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, savedLayouts: [sample] },
      loaded: true,
    });
    const updateSettings = vi.fn(
      async (partial: Partial<Settings>): Promise<GetSettingsResponse> => ({
        settings: { ...DEFAULT_SETTINGS, ...partial },
      }),
    );
    installBridge({ updateSettings });
    render(<LayoutsScreen onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("layouts-delete-usr-sample"));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    const arg = updateSettings.mock.calls[0]?.[0] as {
      savedLayouts: SavedLayout[];
    };
    expect(arg.savedLayouts).toEqual([]);
  });

  it("Save current canvas calls saveCurrentLayout + the new layout lands in savedLayouts", async () => {
    // Seed the canvas with one live node so the save snapshot has shape.
    useCanvasStore.setState({
      nodes: [
        {
          id: "live-p1",
          type: "terminal",
          position: { x: 0, y: 0 },
          data: { cwd: "/foo", cliId: "codex" },
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
    render(<LayoutsScreen onApply={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByTestId("layouts-save-name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My snapshot" } });
    fireEvent.click(screen.getByTestId("layouts-save-btn"));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    const arg = updateSettings.mock.calls[0]?.[0] as {
      savedLayouts: SavedLayout[];
    };
    expect(arg.savedLayouts).toHaveLength(1);
    expect(arg.savedLayouts[0]?.name).toBe("My snapshot");
    expect(arg.savedLayouts[0]?.nodes).toHaveLength(1);
    // The snapshot preserves the cliId binding the live pane had — so a layout
    // saved from an applied-then-modified builtin preserves the CLI binding.
    expect(arg.savedLayouts[0]?.nodes[0]?.cliId).toBe("codex");
  });

  it("Rename commits via Enter: typing a new name + hitting Enter calls renameSavedLayout", async () => {
    const sample: SavedLayout = {
      id: "usr-sample",
      name: "Sample",
      nodes: [
        {
          paneId: "p1",
          cwd: null,
          position: { x: 0, y: 0 },
          cliId: "codex",
        },
      ],
    };
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, savedLayouts: [sample] },
      loaded: true,
    });
    const updateSettings = vi.fn(
      async (partial: Partial<Settings>): Promise<GetSettingsResponse> => ({
        settings: { ...DEFAULT_SETTINGS, ...partial },
      }),
    );
    installBridge({ updateSettings });
    render(<LayoutsScreen onApply={vi.fn()} onClose={vi.fn()} />);
    // Click the name button → flips to an inline <input>.
    fireEvent.click(screen.getByTestId("layouts-rename-btn-usr-sample"));
    const renameInput = (await screen.findByTestId(
      "layouts-rename-input-usr-sample",
    )) as HTMLInputElement;
    fireEvent.change(renameInput, { target: { value: "Renamed" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    const arg = updateSettings.mock.calls[0]?.[0] as {
      savedLayouts: SavedLayout[];
    };
    expect(arg.savedLayouts[0]?.name).toBe("Renamed");
  });

  it("Close button fires onClose", () => {
    const onClose = vi.fn();
    render(<LayoutsScreen onApply={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("layouts-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
