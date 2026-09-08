import type { ITheme } from "@xterm/xterm";
import type { ThemeTokens } from "@/themes";

export function toXtermTheme(t: ThemeTokens): ITheme {
  return {
    background: t["bg-elevated"],
    foreground: t["fg"],
    cursor: t["cursor"],
    cursorAccent: t["bg-elevated"],
    selectionBackground: t["selection-bg"],
    selectionForeground: t["selection-fg"],
    black: t["ansi-0"], red: t["ansi-1"], green: t["ansi-2"], yellow: t["ansi-3"],
    blue: t["ansi-4"], magenta: t["ansi-5"], cyan: t["ansi-6"], white: t["ansi-7"],
    brightBlack: t["ansi-8"], brightRed: t["ansi-9"], brightGreen: t["ansi-10"], brightYellow: t["ansi-11"],
    brightBlue: t["ansi-12"], brightMagenta: t["ansi-13"], brightCyan: t["ansi-14"], brightWhite: t["ansi-15"],
  };
}