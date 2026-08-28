// TerminalNode — cliId threading (the Layouts feature). Layouts (built-in +
// user-saved) stamp cliId onto the canvas node's data via canvas's
// nodesFromPersist; TerminalNode forwards it to TerminalPane so the spawn-
// resolved auto-launch primitive fires when the layout's bound CLI is
// installed. We use a richer TerminalPane mock that captures its props via a
// hoisted spy so we can assert on what TerminalNode handed down (the existing
// TerminalNode.test.tsx mocks TerminalPane to render nothing — fine for chip-
// strip assertions, zero-prop-inspection for cliId).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { makeTestBridge } from "../setupTests";
import { ThemeProvider } from "@/themes";
import { TerminalNode } from "@/components/TerminalNode";
import { useCliToolsStore } from "@/stores/cliTools";
import { useTerminalsStore } from "@/stores/terminals";

// vi.hoisted so the spy + vi.mock factory share the same closure across the
// hoisting transformation vitest applies to vi.mock calls. Set/clear gets via
// the closure (no module-level mutable state on the file).
const spy = vi.hoisted(() => {
  let lastProps: Record<string, unknown> | null = null;
  return {
    setLast: (p: Record<string, unknown>): void => {
      lastProps = p;
    },
    getLast: (): Record<string, unknown> | null => lastProps,
    reset: (): void => {
      lastProps = null;
    },
  };
});

vi.mock("@/terminals/TerminalPane", () => ({
  TerminalPane: (props: Record<string, unknown>) => {
    spy.setLast(props);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  useCliToolsStore.setState({ cliTools: [], loaded: false });
  useTerminalsStore.setState({ panes: {} });
  spy.reset();
});

describe("TerminalNode — cliId threading", () => {
  it("forwards data.cliId through to TerminalPane's cliId prop", () => {
    (
      window as unknown as { bridge: ReturnType<typeof makeTestBridge> }
    ).bridge = makeTestBridge({ ptyWrite: vi.fn(async () => undefined) });
    useCliToolsStore.setState({ cliTools: [], loaded: true });

    const props = {
      id: "p1",
      data: { cwd: null, cliId: "codex" },
    } as unknown as NodeProps;
    render(
      <ReactFlowProvider>
        <ThemeProvider>
          <TerminalNode {...props} />
        </ThemeProvider>
      </ReactFlowProvider>,
    );

    const forwarded = spy.getLast();
    expect(forwarded).not.toBeNull();
    expect(forwarded).toMatchObject({
      paneId: "p1",
      cwd: null,
      cliId: "codex",
    });
  });

  it("falls back to cliId=null when data.cliId is undefined (back-compat for the existing 4-pane default)", () => {
    (
      window as unknown as { bridge: ReturnType<typeof makeTestBridge> }
    ).bridge = makeTestBridge({ ptyWrite: vi.fn(async () => undefined) });
    useCliToolsStore.setState({ cliTools: [], loaded: true });

    const props = { id: "p1", data: {} } as unknown as NodeProps;
    render(
      <ReactFlowProvider>
        <ThemeProvider>
          <TerminalNode {...props} />
        </ThemeProvider>
      </ReactFlowProvider>,
    );

    const forwarded = spy.getLast();
    expect(forwarded).not.toBeNull();
    expect(forwarded).toMatchObject({ paneId: "p1", cwd: null, cliId: null });
  });
});
