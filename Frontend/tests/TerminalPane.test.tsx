// TerminalPane — single pane lifecycle. Asserts:
//   (1) the bridge ptySpawn is called on mount with the paneId + initial
//       geometry (80x24);
//   (2) the data roundtrip — an `onPtyData` event for this pane is written
//       onto the (mock) xterm canvas; events for other panes are filtered out;
//   (3) the exit path — `onPtyExit` flips the terminals-store pane alive=false
//       with the routed exitCode.
// The xterm Terminal class is globally mocked in setupTests.ts; we drive the
// data event through the seized `onPtyData` lambda and read back through
// `Xterm.__last()`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { makeTestBridge } from "../setupTests";
import * as Xterm from "@xterm/xterm";
import { ThemeProvider } from "@/themes";
import { TerminalPane } from "@/terminals/TerminalPane";
import { useTerminalsStore } from "@/stores/terminals";

type Pty = ReturnType<typeof makeTestBridge>;
type DataEvent = { paneId: string; type: "data"; data: string };
type ExitEvent = { paneId: string; type: "exit"; exitCode: number };

beforeEach(() => {
  // Drop mock-Terminal instances left over from other tests so __last()
  // always refers to the one this render mounted.
  const x = Xterm as unknown as { __reset?: () => void };
  x.__reset?.();
});

afterEach(() => {
  cleanup();
});

function setBridge(bridge: Pty): void {
  (window as unknown as { bridge: Pty }).bridge = bridge;
}

describe("TerminalPane", () => {
  it("spawns a pty on mount with the paneId + initial geometry", () => {
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
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[0]).toMatchObject({
      paneId: "probe",
      cols: 80,
      rows: 24,
    });
  });

  it("writes incoming onPtyData events to the xterm canvas (data roundtrip)", async () => {
    let seizeData: ((evt: DataEvent) => void) | null = null;
    setBridge(
      makeTestBridge({
        onPtyData: (cb) => {
          seizeData = cb as (evt: DataEvent) => void;
          return () => undefined;
        },
      }),
    );
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    // Microtask round so the mount effect's async spawn resolves and the
    // `onPtyData` subscription is registered before we drive the event.
    await Promise.resolve();
    await Promise.resolve();

    const mock = (
      Xterm as unknown as {
        __last?: () => { write: ReturnType<typeof vi.fn> };
      }
    ).__last?.();
    expect(mock, "expected a mock Terminal instance from Xterm.__last").toBeDefined();
    expect(seizeData).not.toBeNull();
    seizeData!({
      paneId: "probe",
      type: "data",
      data: "hello\r\n",
    });
    expect(mock!.write).toHaveBeenCalledWith("hello\r\n");
  });

  it("marks the pane exited on onPtyExit with the routed exitCode", async () => {
    let seizeExit: ((evt: ExitEvent) => void) | null = null;
    setBridge(
      makeTestBridge({
        onPtyExit: (cb) => {
          seizeExit = cb as (evt: ExitEvent) => void;
          return () => undefined;
        },
      }),
    );
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" />
      </ThemeProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    seizeExit!({
      paneId: "probe",
      type: "exit",
      exitCode: 9,
    });
    const pane = useTerminalsStore.getState().panes["probe"];
    expect(pane?.alive).toBe(false);
    expect(pane?.exitCode).toBe(9);
  });
});
