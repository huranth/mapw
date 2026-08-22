import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_SETTINGS, type Settings } from "@bridgespace/backend/renderer";
import type { Bridge, GetSettingsResponse } from "@/bridge/types";
import { App } from "@/App";
import { makeTestBridge } from "../setupTests";

// Build a complete Bridge from a partial override. makeTestBridge fills the
// pty surface with no-op/echo defaults, so mounting <App/> (which renders the
// M2 freeform terminal canvas — four seed nodes via React Flow) does not blow
// up in any settings-only test.
function installBridge(overrides: Partial<Bridge> = {}): void {
  (window as unknown as { bridge: Bridge }).bridge = makeTestBridge(overrides);
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-bs-theme");
  document.documentElement.style.cssText = "";
});

beforeEach(() => {
  vi.resetModules();
});

describe("App", () => {
  it("renders the brand in the title bar", () => {
    installBridge({});
    render(<App />);
    expect(screen.getByText(/^MAPW$/)).toBeInTheDocument();
  });

  it("renders exactly one theme button (single-theme UI)", () => {
    installBridge({});
    render(<App />);
    // The Paper pill in the title bar is the only theme-affordance button
    // that names itself "Paper". React Flow injects per-node close buttons +
    // the canvas's "+ New terminal" chip — all of which are role="button"
    // too, so a raw getAllByRole would over-count. Scope to the named pill.
    expect(screen.getAllByRole("button", { name: /Paper/i })).toHaveLength(1);
  });

  it("renders the active theme id in the workspace placeholder", () => {
    installBridge({});
    render(<App />);
    expect(screen.getByTestId("active-theme-id").textContent).toBe(
      DEFAULT_SETTINGS.theme,
    );
  });

  it("clicking the theme pill calls bridge.updateSettings with the theme id", async () => {
    const updateSettings = vi.fn(
      async (partial: Partial<Settings>): Promise<GetSettingsResponse> => ({
        settings: { ...DEFAULT_SETTINGS, ...partial },
      }),
    );
    installBridge({ updateSettings });
    render(<App />);
    // The single shipped theme is `paper` (display name "Paper"). Clicking
    // the pill still persists the *id* ("paper") through the bridge.
    const paperButton = screen.getByRole("button", { name: /Paper/i });
    paperButton.click();
    expect(updateSettings).toHaveBeenCalledWith({ theme: "paper" });
  });
});
