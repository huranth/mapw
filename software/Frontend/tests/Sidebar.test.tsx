import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@bridgespace/backend/renderer";
import type { Bridge } from "@/bridge/types";
import { Sidebar } from "@/components/Sidebar";
import { useSettingsStore } from "@/stores/settings";
import { useUsageStore } from "@/stores/usage";
import { makeTestBridge } from "../setupTests";

function installBridge(overrides: Partial<Bridge> = {}): void {
  (window as unknown as { bridge: Bridge }).bridge = makeTestBridge(overrides);
}

beforeEach(() => {
  installBridge();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
  useUsageStore.setState({ sessions: 0, activeSeconds: 0 });
});

afterEach(() => cleanup());

describe("Sidebar user card", () => {
  it("shows the stored user name with derived initials", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, userName: "daniel kane" },
      loaded: true,
    });
    render(<Sidebar />);
    expect(screen.getByText("daniel kane")).toBeInTheDocument();
    expect(screen.getByText("DK")).toBeInTheDocument();
  });

  it("bootstraps the profile from the OS account when no name is stored", async () => {
    const updateSettings = vi.fn(async (partial: Partial<typeof DEFAULT_SETTINGS>) => ({
      settings: { ...DEFAULT_SETTINGS, ...partial },
    }));
    installBridge({ whoami: async () => "huranth", updateSettings });
    render(<Sidebar />);
    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ userName: "huranth" });
    });
  });

  it("does not call whoami once a name is stored", () => {
    const whoami = vi.fn(async () => "huranth");
    installBridge({ whoami });
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, userName: "daniel" },
      loaded: true,
    });
    render(<Sidebar />);
    expect(whoami).not.toHaveBeenCalled();
  });

  it("summarizes real usage under the name", () => {
    useUsageStore.setState({ sessions: 2, activeSeconds: 3660 });
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, userName: "daniel" },
      loaded: true,
    });
    render(<Sidebar />);
    expect(screen.getByText("2 sessions, 1.0 hrs")).toBeInTheDocument();
  });
});
