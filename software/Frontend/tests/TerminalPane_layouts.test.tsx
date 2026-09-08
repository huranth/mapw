// TerminalPane — layout CLI auto-launch. The pane's bound cliId fires
// `ptyWrite(paneId, `${launchCommand}\r`)` exactly once after ptySpawn
// resolves (the spawn-resolved `.then()` block in TerminalPane.tsx). Three
// cases:
//   (a) cliId="claude" + claude installed → ptyWrite fires once with
//       `claude\r`;
//   (b) cliId="claude" + claude NOT installed → ptyWrite does NOT fire + a
//       one-line yellow warning lands via terminal.writeln (the chip strip
//       stays live for a manual launch);
//   (c) cliId=null (= undefined; the boot-default case) → ptyWrite does NOT
//       fire (the chip-strip click path is the only CLI-launch primitive,
//       exactly as the pre-feature baseline).
//
// Path mirrors the existing TerminalPane.test.tsx — xterm's Terminal mock in
// setupTests exposes __last() for accessing writeln/write on the most-recent
// Terminal instance; we use `useCliToolsStore.setState` to seed the installed
// CLI list.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { makeTestBridge } from "../setupTests";
import * as Xterm from "@xterm/xterm";
import { ThemeProvider } from "@/themes";
import { TerminalPane } from "@/terminals/TerminalPane";
import { useCliToolsStore } from "@/stores/cliTools";
import type { DetectedCliTool } from "@mapw/backend/renderer";

const sampleDetected: DetectedCliTool[] = [
  {
    id: "codex",
    name: "codex",
    binary: "codex",
    launchCommand: "codex",
    path: "/usr/local/bin/codex",
  },
  {
    id: "claude",
    name: "claude",
    binary: "claude",
    launchCommand: "claude",
    path: "/usr/local/bin/claude",
  },
];

type Pty = ReturnType<typeof makeTestBridge>;

beforeEach(() => {
  // Drop mock-Terminal instances left over from other tests so __last()
  // always refers to the one this render mounted.
  const x = Xterm as unknown as { __reset?: () => void };
  x.__reset?.();
  useCliToolsStore.setState({ cliTools: [], loaded: true });
});

afterEach(() => {
  cleanup();
  useCliToolsStore.setState({ cliTools: [], loaded: false });
});

function setBridge(bridge: Pty): void {
  (window as unknown as { bridge: Pty }).bridge = bridge;
}

describe("TerminalPane — layout CLI auto-launch", () => {
  it("fires `claude\\r` exactly once after ptySpawn resolves when cliId=claude AND claude is installed", async () => {
    const ptyWrite = vi.fn(async () => undefined);
    setBridge(makeTestBridge({ ptyWrite }));
    useCliToolsStore.setState({ cliTools: sampleDetected, loaded: true });
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" cliId="claude" />
      </ThemeProvider>,
    );
    // Microtask round so the mount effect's async spawn resolves + the
    // .then() chain (where the auto-launch fires) settles. The existing
    // data-roundtrip test uses 2 awaits for the same ptySpawn.then()
    // settlement; we mirror that.
    await Promise.resolve();
    await Promise.resolve();
    expect(ptyWrite).toHaveBeenCalledTimes(1);
    expect(ptyWrite.mock.calls[0]).toEqual(["probe", "claude\r"]);
  });

  it("writes a yellow warning + does NOT call ptyWrite when cliId=claude AND claude is NOT installed", async () => {
    const ptyWrite = vi.fn(async () => undefined);
    setBridge(makeTestBridge({ ptyWrite }));
    // Seed just `codex` — claude is missing.
    useCliToolsStore.setState({
      cliTools: [sampleDetected[0]!],
      loaded: true,
    });
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" cliId="claude" />
      </ThemeProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(ptyWrite).not.toHaveBeenCalled();
    const mock = (
      Xterm as unknown as {
        __last?: () => { writeln: ReturnType<typeof vi.fn> };
      }
    ).__last?.();
    expect(mock?.writeln).toHaveBeenCalled();
    const warnArg = String(mock?.writeln.mock.calls[0]?.[0] ?? "");
    expect(warnArg).toMatch(/\[mapw\] layout CLI "claude" not installed/);
  });

  it("does NOT auto-fire ptyWrite when cliId is null (the existing chip-strip behaviour stays intact)", async () => {
    const ptyWrite = vi.fn(async () => undefined);
    setBridge(makeTestBridge({ ptyWrite }));
    useCliToolsStore.setState({ cliTools: sampleDetected, loaded: true });
    render(
      <ThemeProvider>
        <TerminalPane paneId="probe" cliId={null} />
      </ThemeProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(ptyWrite).not.toHaveBeenCalled();
  });
});
