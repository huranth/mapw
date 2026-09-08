import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  applyThemeVars,
  getTheme,
  THEMES,
  DEFAULT_THEME_ID,
  ThemeProvider,
  useTheme,
} from "@/themes";
import { THEME_TOKEN_NAMES } from "@/themes/tokens";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-mapw-theme");
  document.documentElement.style.cssText = "";
});

describe("theme registry", () => {
  it("ships exactly 1 theme for M0 (single-theme UI)", () => {
    expect(THEMES).toHaveLength(1);
  });

  it("declares paper as the default theme", () => {
    expect(DEFAULT_THEME_ID).toBe("paper");
  });

  it("looks up the known id and falls back to the first theme for unknown ids", () => {
    expect(getTheme("paper").id).toBe("paper");
    expect(getTheme("nonexistent").id).toBe(THEMES[0]?.id ?? "__missing__");
  });
});

describe("applyThemeVars", () => {
  it("writes every theme token as a --mapw-* css variable on document root", () => {
    applyThemeVars(getTheme("paper"));
    for (const name of THEME_TOKEN_NAMES) {
      const v = document.documentElement.style.getPropertyValue(`--mapw-${name}`);
      expect(v, `--mapw-${name} should be set`).not.toBe("");
    }
    expect(document.documentElement.dataset.mapwTheme).toBe("paper");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("stamps a light colorScheme for the single light theme", () => {
    applyThemeVars(getTheme("paper"));
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});

describe("ThemeProvider", () => {
  function Probe() {
    const { theme } = useTheme();
    return <div data-testid="theme-id">{theme.id}</div>;
  }

  it("reflects the store's active theme to consumers", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme-id").textContent).toBe(DEFAULT_THEME_ID);
  });
});
