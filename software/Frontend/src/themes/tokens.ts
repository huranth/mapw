export const THEME_TOKEN_NAMES = [
  "bg",
  "bg-alt",
  "bg-elevated",
  "bg-hover",
  "fg",
  "fg-muted",
  "fg-inverse",
  "border",
  "border-strong",
  "accent",
  "accent-fg",
  "accent-strong",
  "error",
  "warn",
  "ok",
  "selection-bg",
  "selection-fg",
  "cursor",
  "ansi-0",
  "ansi-1",
  "ansi-2",
  "ansi-3",
  "ansi-4",
  "ansi-5",
  "ansi-6",
  "ansi-7",
  "ansi-8",
  "ansi-9",
  "ansi-10",
  "ansi-11",
  "ansi-12",
  "ansi-13",
  "ansi-14",
  "ansi-15",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

export type ThemeTokens = Record<ThemeTokenName, string>;

export interface Theme {
  id: string;
  name: string;
  appearance: "dark" | "light";
  tokens: ThemeTokens;
}
