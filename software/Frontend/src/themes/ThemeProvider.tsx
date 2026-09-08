import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useSettingsStore } from "@/stores/settings";
import { getTheme, THEMES, type Theme } from "./themes";
import { THEME_TOKEN_NAMES } from "./tokens";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (id: string) => void;
  availableThemes: ReadonlyArray<Theme>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function applyThemeVars(theme: Theme): void {
  const root = document.documentElement;
  for (const name of THEME_TOKEN_NAMES) {
    root.style.setProperty(`--mapw-${name}`, theme.tokens[name]);
  }
  root.dataset.mapwTheme = theme.id;
  root.style.colorScheme = theme.appearance;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const themeId = useSettingsStore((s) => s.settings.theme);
  const updateSettings = useSettingsStore((s) => s.update);
  const theme = useMemo(() => getTheme(themeId), [themeId]);

  useEffect(() => {
    applyThemeVars(theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: (id: string) => {
        void updateSettings({ theme: id });
      },
      availableThemes: THEMES,
    }),
    [theme, updateSettings],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme() must be rendered inside <ThemeProvider>");
  return ctx;
}