// paper — the only shipped theme. Near-white sheet, near-black ink, 1px
// hairlines, blue accent. Token names stay on the existing THEME_TOKEN_NAMES
// surface so applyThemeVars / toXtermTheme / the test suite keep working
// unchanged. The matching fork written into ~/.config/opencode for any
// opencode launched inside a pane lives at
// Frontend/electron/themes/paper-bare.json.

import type { Theme } from "./tokens";

export const paperTheme: Theme = {
  id: "paper",
  name: "Paper",
  appearance: "light",
  tokens: {
    "bg":            "#FAFAFA",
    "bg-alt":        "#F2F2F2", // faint wells / soft fills
    "bg-elevated":   "#FFFFFF", // pure-white cards on top of the sheet
    "bg-hover":      "#EAEAEA", // hover fills on ghost buttons
    "fg":            "#171717", // ink
    "fg-muted":      "#8F8F8F",
    "fg-inverse":    "#FFFFFF", // text on accent fill (white-on-blue)
    "border":        "#EAEAEA", // hairline
    "border-strong": "#171717", // ink-strong emphasis edge (matches fg)
    "accent":        "#0070F3", // blue — links / focus / active
    "accent-fg":     "#FFFFFF",
    "accent-strong": "#0761D1", // deep accent — pressed / active
    "error":         "#E5484D",
    "warn":          "#FFB224",
    "ok":            "#46A758",
    "selection-bg":  "rgba(0, 112, 243, 0.14)",
    "selection-fg":  "#171717",
    "cursor":        "#171717",
    // ANSI 16 — kept in step with the chrome so any ANSI-coloured output
    // streams in the same register as the surrounding UI.
    "ansi-0":  "#0A0A0A", // black
    "ansi-1":  "#E5484D", // red
    "ansi-2":  "#46A758", // green
    "ansi-3":  "#FFB224", // yellow
    "ansi-4":  "#0070F3", // blue (accent)
    "ansi-5":  "#8E4EC6", // magenta
    "ansi-6":  "#50E3C2", // cyan
    "ansi-7":  "#FAFAFA", // white
    "ansi-8":  "#8F8F8F", // bright black
    "ansi-9":  "#FF6166", // bright red
    "ansi-10": "#63C46D", // bright green
    "ansi-11": "#F2A700", // bright yellow
    "ansi-12": "#52A8FF", // bright blue
    "ansi-13": "#BF7AF0", // bright magenta
    "ansi-14": "#0AC7AC", // bright cyan
    "ansi-15": "#FFFFFF", // bright white
  },
};
