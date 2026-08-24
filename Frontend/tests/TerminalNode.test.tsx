// TerminalNode — the React Flow custom node whose body wraps a TerminalPane
// + whose header carries dots, a label, the famous-CLI chip strip, Copy,
// and Close. This suite exercises the chip-strip behavior introduced when
// the auto-opencode launch was replaced with raw-boot + user-triggered
// launches:
//   (1) the chip strip renders one button per detected CLI with the right
//       launch aria-label shape;
//   (2) clicking a chip writes `${cli.launchCommand}\r` into the pane's PTY
//       stdin — the same primitive the old hardcoded "opencode\r" used;
//   (3) when `tuiRunning` flips true on the pane (first `\x1b[?1049h`),
//       the chip-strip container gains the HTML5 `hidden` attribute
//       (UA-default display:none) so the user can't fire a launch into a
//       running TUI's stdin;
//   (4) flipping `tuiRunning` back to false (first `\x1b[?1049l` on exit)
//       removes the `hidden` attribute so the strip reappears;
//   (5) an empty curated scan (no installed CLIs) yields no chip buttons.
//
// We vi.mock the TerminalPane import out of the render tree — TerminalPane's
// mount effect spawns a PTY + wires the xterm canvas, which the chip-strip
// tests don't care about. The mock returns null so TerminalNode mounts
// cleanly without the heavy pane lifecycle.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import type { DetectedCliTool } from "@bridgespace/backend/renderer";
import { makeTestBridge } from "../setupTests";
import { ThemeProvider } from "@/themes";
import { TerminalNode } from "@/components/TerminalNode";
import { useCliToolsStore } from "@/stores/cliTools";
import { useTerminalsStore } from "@/stores/terminals";

vi.mock("@/terminals/TerminalPane", () => ({
  TerminalPane: () => null,
}));

const sampleDetected: DetectedCliTool[] = [
  {
    id: "opencode",
    name: "opencode",
    binary: "opencode",
    launchCommand: "opencode",
    path: "/usr/local/bin/opencode",
  },
  {
    id: "claude",
    name: "claude",
    binary: "claude",
    launchCommand: "claude",
    path: "/usr/local/bin/claude",
  },
];

// TerminalNode destructures `{ id, data }` from NodeProps; the other NodeProps
// fields are not consulted by TerminalNode itself, so a partial cast via
// `as unknown as NodeProps` is the lightest way to render it standalone (no
// React Flow <ReactFlow> wrapper required).
const NODE_PROPS_P1 = { id: "p1", data: {} } as unknown as NodeProps;

afterEach(() => {
  cleanup();
  useCliToolsStore.setState({ cliTools: [], loaded: false });
  useTerminalsStore.setState({ panes: {} });
});

function setBridge(bridge: ReturnType<typeof makeTestBridge>): void {
  (window as unknown as { bridge: ReturnType<typeof makeTestBridge> }).bridge =
    bridge;
}

describe("TerminalNode — CLI chip strip", () => {
  it("renders one chip per detected CLI with the right launch aria-label", () => {
    setBridge(makeTestBridge({ ptyWrite: vi.fn(async () => undefined) }));
    useCliToolsStore.setState({ cliTools: sampleDetected, loaded: true });

    // TerminalNode renders <Handle> (the xyflow connection dots on each side
    // of the pane) which calls useStoreApi internally — that store lives on
    // the ReactFlow context, so we need <ReactFlowProvider> upstream or the
    // handles blow up at first render. <ThemeProvider> provides the paper
    // theme tokens that stylize the chip-strip container.
    render(
      <ReactFlowProvider>
        <ThemeProvider>
          <TerminalNode {...NODE_PROPS_P1} />
        </ThemeProvider>
      </ReactFlowProvider>,
    );

    expect(
      screen.getByRole("button", { name: /Launch opencode in p1/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Launch claude in p1/i }),
    ).toBeInTheDocument();
  });

  it("clicking a chip writes `${launchCommand}\\r` into the pane's PTY stdin", async () => {
    const ptyWrite = vi.fn(async () => undefined);
    setBridge(makeTestBridge({ ptyWrite }));
    useCliToolsStore.setState({ cliTools: sampleDetected, loaded: true });

    // TerminalNode renders <Handle> (the xyflow connection dots on each side
    // of the pane) which calls useStoreApi internally — that store lives on
    // the ReactFlow context, so we need <ReactFlowProvider> upstream or the
    // handles blow up at first render. <ThemeProvider> provides the paper
    // theme tokens that stylize the chip-strip container.
    render(
      <ReactFlowProvider>
        <ThemeProvider>
          <TerminalNode {...NODE_PROPS_P1} />
        </ThemeProvider>
      </ReactFlowProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Launch claude in p1/i }),
    );
    await waitFor(() => expect(ptyWrite).toHaveBeenCalledTimes(1));
    expect(ptyWrite.mock.calls[0]).toEqual(["p1", "claude\r"]);
  });

  it("hides the chip strip when tuiRunning flips true on the pane, reappears on false", async () => {
    setBridge(makeTestBridge({ ptyWrite: vi.fn(async () => undefined) }));
    useCliToolsStore.setState({ cliTools: sampleDetected, loaded: true });
    useTerminalsStore.getState().register("p1");

    // TerminalNode renders <Handle> (the xyflow connection dots on each side
    // of the pane) which calls useStoreApi internally — that store lives on
    // the ReactFlow context, so we need <ReactFlowProvider> upstream or the
    // handles blow up at first render. <ThemeProvider> provides the paper
    // theme tokens that stylize the chip-strip container.
    render(
      <ReactFlowProvider>
        <ThemeProvider>
          <TerminalNode {...NODE_PROPS_P1} />
        </ThemeProvider>
      </ReactFlowProvider>,
    );

    // Initial render — tuiRunning defaults to false on register, so the
    // chip strip's container has no `hidden` attribute.
    const chips = screen.getByTestId("node-p1-chips");
    expect(chips).not.toHaveAttribute("hidden");

    // Simulate the enter-alt-screen event TerminalPane fires on a TUI launch
    // (first `\x1b[?1049h` chunk on the pane's PTY stream).
    useTerminalsStore.getState().markTuiEntered("p1");
    await waitFor(() => expect(chips).toHaveAttribute("hidden"));

    // Simulate the user exiting the TUI back to the bare shell — the
    // inverse `\x1b[?1049l` sequence fires markTuiExited on the same pane.
    useTerminalsStore.getState().markTuiExited("p1");
    await waitFor(() => expect(chips).not.toHaveAttribute("hidden"));
  });

  it("renders no chip buttons when the curated scan is empty (no installed CLIs)", () => {
    setBridge(makeTestBridge({ ptyWrite: vi.fn(async () => undefined) }));
    useCliToolsStore.setState({ cliTools: [], loaded: true });

    // TerminalNode renders <Handle> (the xyflow connection dots on each side
    // of the pane) which calls useStoreApi internally — that store lives on
    // the ReactFlow context, so we need <ReactFlowProvider> upstream or the
    // handles blow up at first render. <ThemeProvider> provides the paper
    // theme tokens that stylize the chip-strip container.
    render(
      <ReactFlowProvider>
        <ThemeProvider>
          <TerminalNode {...NODE_PROPS_P1} />
        </ThemeProvider>
      </ReactFlowProvider>,
    );

    // The chips container still renders (it's a presentational surface
    // owned by TerminalNode) but holds zero buttons — so no "Launch X"
    // affordances are findable via queryAllByRole.
    expect(screen.queryAllByRole("button", { name: /Launch /i })).toEqual([]);
  });
});
