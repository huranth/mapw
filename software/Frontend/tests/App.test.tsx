import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@bridgespace/backend/renderer";
import type { Bridge } from "@/bridge/types";
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
  it("renders the brand in the sidebar", () => {
    installBridge({});
    render(<App />);
    expect(screen.getByLabelText(/mapw/i)).toBeInTheDocument();
  });

  it("applies the active theme id to the document root", () => {
    installBridge({});
    render(<App />);
    // ThemeProvider's applyThemeVars writes `theme.id` (e.g. "paper") onto
    // <html data-bs-theme>. The StatusBar that previously surfaced the
    // `active-theme-id` testid was removed, so the root attribute is now the
    // canonical theme cue.
    expect(document.documentElement.dataset.bsTheme).toBe(
      DEFAULT_SETTINGS.theme,
    );
  });

});
