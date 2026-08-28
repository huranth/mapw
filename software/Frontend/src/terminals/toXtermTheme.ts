// Theme tokens → xterm.js ITheme. xterm's Theme surface is a thin subset of
// the full token palette — we map foreground / background / cursor /
// selection + the 16-color ANSI palette into the `--bs-*` namespace. Panes
// recolor with the ThemeProvider (TerminalPane re-applies on every theme
// change).

import type { ITheme } from "@xterm/xterm";
import type { ThemeTokens } from "@/themes";

export function toXtermTheme(tokens: ThemeTokens): ITheme {
  return {
    // Pane bg uses the elevated (pure-white) surface so xterm flushes against
    // the surrounding card chrome (card sits on the canvas's --bs-bg #FAFAFA;
    // xterm inside sits on --bs-bg-elevated #FFFFFF).
    background: tokens["bg-elevated"],
    foreground: tokens["fg"],
    cursor: tokens["cursor"],
    cursorAccent: tokens["bg-elevated"],
    selectionBackground: tokens["selection-bg"],
    selectionForeground: tokens["selection-fg"],
    black: tokens["ansi-0"],
    red: tokens["ansi-1"],
    green: tokens["ansi-2"],
    yellow: tokens["ansi-3"],
    blue: tokens["ansi-4"],
    magenta: tokens["ansi-5"],
    cyan: tokens["ansi-6"],
    white: tokens["ansi-7"],
    brightBlack: tokens["ansi-8"],
    brightRed: tokens["ansi-9"],
    brightGreen: tokens["ansi-10"],
    brightYellow: tokens["ansi-11"],
    brightBlue: tokens["ansi-12"],
    brightMagenta: tokens["ansi-13"],
    brightCyan: tokens["ansi-14"],
    brightWhite: tokens["ansi-15"],
  };
}
