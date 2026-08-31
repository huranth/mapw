import type { Theme } from "./tokens";
import { paperTheme } from "./paper";

export const THEMES: ReadonlyArray<Theme> = [paperTheme];
export const DEFAULT_THEME_ID = "paper";
export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

export type { Theme } from "./tokens";
