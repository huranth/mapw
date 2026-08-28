import type { Theme } from "./tokens";
import { paperTheme } from "./paper";

// Single-theme UI: the `paper` theme is the only shipped palette. The array
// shape stays so getTheme()'s "first theme on unknown id" fallback and the
// title bar's theme pill keep working unchanged. Append more themes here
// when the multitheme UI ships.
export const THEMES: ReadonlyArray<Theme> = [paperTheme];

export const DEFAULT_THEME_ID = "paper";

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

export type { Theme } from "./tokens";
