// WelcomeSetupScreen — the surface Workspace renders when there is NO
// persisted workspace skeleton AND no pre-feature legacy lastCwd (first-ever
// launch), AND whenever the ReturningScreen's "Choose a new folder" fires
// (returning launch that opts to start fresh). Two modes:
//   - Shared (default): one Folder picker card; the picked folder seeds all
//     4 panes.
//   - Per pane (toggle opt-in): a 2x2 grid of 4 picker cards, one per seed
//     paneId (p1..p4); CTA stays disabled until ALL 4 slots are filled.
// The native OS folder picker fires only from a button onClick (so StrictMode's
// double-mount is harmless); cancel resolves nothing — slot stays empty, CTA
// stays disabled.
//
// These tests drive the picker via a mocked bridge.openDirectoryDialog and
// assert on the onCommit callback's (PaneNodePersist[], primaryCwd) payload —
// the same payload Workspace turns into Settings.workspace + Settings.lastCwd
// and feeds to canvas.hydrate before flipping phase to "ready".

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { makeTestBridge } from "../setupTests";
import { WelcomeSetupScreen } from "@/components/WelcomeSetupScreen";

afterEach(() => {
  cleanup();
});

function setBridge(bridge: ReturnType<typeof makeTestBridge>): void {
  (window as unknown as { bridge: ReturnType<typeof makeTestBridge> }).bridge =
    bridge;
}

describe("WelcomeSetupScreen", () => {
  it("renders shared mode by default with CTA disabled and Folder card empty", () => {
    setBridge(makeTestBridge());
    render(<WelcomeSetupScreen onCommit={vi.fn()} />);

    expect(screen.getByTestId("welcome-screen")).toBeInTheDocument();
    expect(screen.getByTestId("welcome-open-workspace")).toBeDisabled();
    // Folder-card empty state: the only "Choose folder" affordance.
    expect(
      screen.getByRole("button", { name: /Choose folder for Folder/i }),
    ).toBeInTheDocument();
    // No per-pane cards expected in shared mode.
    expect(
      screen.queryByRole("button", { name: /Choose folder for Terminal p/i }),
    ).not.toBeInTheDocument();
  });

  it("shared mode: picker resolves -> CTA enables -> Open workspace commits the 4-pane skeleton in the picked folder", async () => {
    const openDirectoryDialog = vi.fn(async () => ({
      canceled: false,
      filePaths: ["/dir"],
    }));
    setBridge(makeTestBridge({ openDirectoryDialog }));
    const onCommit = vi.fn();

    render(<WelcomeSetupScreen onCommit={onCommit} />);

    const openWs = screen.getByTestId("welcome-open-workspace");
    expect(openWs).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: /Choose folder for Folder/i }),
    );
    await waitFor(() => expect(openWs).toBeEnabled());

    fireEvent.click(openWs);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [nodesArg, primaryCwdArg] = onCommit.mock.calls[0] as [
      Array<{
        paneId: string;
        cwd: string | null;
        position: { x: number; y: number };
      }>,
      string,
    ];
    expect(primaryCwdArg).toBe("/dir");
    expect(nodesArg).toHaveLength(4);
    // The 2x2 default slot geometry (NODE_W=420 + GRID_GAP=28 = 448 across,
    // NODE_H=260 + GRID_GAP=28 = 288 down). seedNodes lays panes in this exact
    // shape so a Continue restore after a fresh-app launch lands each pane
    // where the Welcome flow left it.
    expect(nodesArg).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paneId: "p1",
          cwd: "/dir",
          position: { x: 0, y: 0 },
        }),
        expect.objectContaining({
          paneId: "p2",
          cwd: "/dir",
          position: { x: 448, y: 0 },
        }),
        expect.objectContaining({
          paneId: "p3",
          cwd: "/dir",
          position: { x: 0, y: 288 },
        }),
        expect.objectContaining({
          paneId: "p4",
          cwd: "/dir",
          position: { x: 448, y: 288 },
        }),
      ]),
    );
  });

  it("per-pane mode: 4 pickers revealed; CTA enables only when all 4 slots filled; commit builds 4 distinct cwds", async () => {
    // Each click resolves to the next entry, so Terminal p1 → /p1, etc. The
    // queued resolutions are decoupled from any particular click order; the
    // test asserts the CTA's ready predicate (every slot non-null) regardless.
    const openDirectoryDialog = vi
      .fn()
      .mockResolvedValueOnce({ canceled: false, filePaths: ["/p1"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["/p2"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["/p3"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["/p4"] });
    setBridge(makeTestBridge({ openDirectoryDialog }));
    const onCommit = vi.fn();

    render(<WelcomeSetupScreen onCommit={onCommit} />);

    // Sanity: shared mode opens with exactly one "Choose folder" card.
    expect(
      screen.getAllByRole("button", { name: /Choose folder for /i }),
    ).toHaveLength(1);

    // Flip the per-pane toggle — the wrapped <input type=checkbox> carries
    // the "Use a different folder per pane" accessible name via its <label>.
    fireEvent.click(
      screen.getByLabelText(/Use a different folder per pane/i),
    );
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /Choose folder for Terminal p/i }),
      ).toHaveLength(4);
    });

    const openWs = screen.getByTestId("welcome-open-workspace");
    expect(openWs).toBeDisabled();

    // Pick each slot in turn. After every partial fill the CTA must stay
    // disabled (predicate requires every entry non-null) — only the FULL
    // 4-slot state enables it.
    fireEvent.click(
      screen.getByRole("button", { name: /Choose folder for Terminal p1/i }),
    );
    await waitFor(() => expect(openDirectoryDialog).toHaveBeenCalledTimes(1));
    expect(openWs).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: /Choose folder for Terminal p2/i }),
    );
    await waitFor(() => expect(openDirectoryDialog).toHaveBeenCalledTimes(2));
    expect(openWs).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: /Choose folder for Terminal p3/i }),
    );
    await waitFor(() => expect(openDirectoryDialog).toHaveBeenCalledTimes(3));
    expect(openWs).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: /Choose folder for Terminal p4/i }),
    );
    await waitFor(() => expect(openDirectoryDialog).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(openWs).toBeEnabled());

    // "Open workspace" with all 4 picked builds a 4-distinct-cwd skeleton;
    // primaryCwd is p1 by convention (cwds[0]).
    fireEvent.click(openWs);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [nodesArg, primaryCwdArg] = onCommit.mock.calls[0] as [
      Array<{
        paneId: string;
        cwd: string | null;
        position: { x: number; y: number };
      }>,
      string,
    ];
    expect(primaryCwdArg).toBe("/p1");
    expect(nodesArg).toHaveLength(4);
    expect(nodesArg).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paneId: "p1", cwd: "/p1" }),
        expect.objectContaining({ paneId: "p2", cwd: "/p2" }),
        expect.objectContaining({ paneId: "p3", cwd: "/p3" }),
        expect.objectContaining({ paneId: "p4", cwd: "/p4" }),
      ]),
    );
  });

  it("shared mode: cancel picker keeps the slot empty -> CTA stays disabled", async () => {
    const openDirectoryDialog = vi.fn(async () => ({
      canceled: true,
      filePaths: [],
    }));
    setBridge(makeTestBridge({ openDirectoryDialog }));
    const onCommit = vi.fn();

    render(<WelcomeSetupScreen onCommit={onCommit} />);

    const openWs = screen.getByTestId("welcome-open-workspace");
    expect(openWs).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: /Choose folder for Folder/i }),
    );
    await waitFor(() =>
      expect(openDirectoryDialog).toHaveBeenCalledTimes(1),
    );

    // The picker resolved canceled → the handler returned early without a
    // setState, so the slot remains empty (still "Choose folder", no "Change"
    // button) and the CTA remains disabled. No commit fired.
    expect(
      screen.getByRole("button", { name: /Choose folder for Folder/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Change Folder/i }),
    ).not.toBeInTheDocument();
    expect(openWs).toBeDisabled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
