export const CODEX_TARGET_THEME = "catppuccin-latte";

const TUI_HEADER_RE = /^[ \t]*\[tui\][ \t]*(#.*)?$/;

const ANY_HEADER_RE = /^[ \t]*\[[^\]]+\]/;

const THEME_KEY_RE = /^[ \t]*theme[ \t]*=[ \t]*/;

const DOTTED_TUI_THEME_RE = /^[ \t]*tui\.theme[ \t]*=[ \t]*/;

const THEME_ASSIGN_PREFIX_RE = /^[ \t]*(?:tui\.)?theme[ \t]*=[ \t]*/;

function parseTomlStringValue(rhs: string): string {
  const s = rhs.replace(/^\s+/, "");
  if (s.startsWith('"')) {
    const j = s.indexOf('"', 1);
    return j === -1 ? s.slice(1) : s.slice(1, j);
  }
  if (s.startsWith("'")) {
    const j = s.indexOf("'", 1);
    return j === -1 ? s.slice(1) : s.slice(1, j);
  }
  const m = s.match(/^([^\s#]+)/);
  return m ? m[1]! : "";
}

function rewriteThemeValue(line: string, theme: string): string {
  const m = line.match(THEME_ASSIGN_PREFIX_RE);
  const prefix = m ? m[0] : "theme = ";
  return `${prefix}"${theme}"`;
}

function joinPreserve(lines: string[], original: string): string {
  const sep = original.includes("\r\n") ? "\r\n" : "\n";
  return lines.join(sep);
}

export function mergeTuiThemeIntoToml(
  input: string,
  theme: string,
): string | null {
  if (input.length === 0) {

    return `[tui]\ntheme = "${theme}"\n`;
  }
  const lines = input.split(/\r?\n/);

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (TUI_HEADER_RE.test(lines[i]!)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx >= 0) {

    let bodyEnd = lines.length;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (ANY_HEADER_RE.test(lines[i]!)) {
        bodyEnd = i;
        break;
      }
    }

    let themeIdx = -1;
    for (let i = headerIdx + 1; i < bodyEnd; i++) {
      if (THEME_KEY_RE.test(lines[i]!)) {
        themeIdx = i;
        break;
      }
    }
    if (themeIdx >= 0) {
      const rhs = lines[themeIdx]!.replace(THEME_KEY_RE, "");
      if (parseTomlStringValue(rhs) === theme) return null;
      lines[themeIdx] = rewriteThemeValue(lines[themeIdx]!, theme);
      return joinPreserve(lines, input);
    }

    lines.splice(headerIdx + 1, 0, `theme = "${theme}"`);
    return joinPreserve(lines, input);
  }

  let firstHeader = -1;
  for (let i = 0; i < lines.length; i++) {
    if (ANY_HEADER_RE.test(lines[i]!)) {
      firstHeader = i;
      break;
    }
  }
  const topLevelEnd = firstHeader === -1 ? lines.length : firstHeader;
  for (let i = 0; i < topLevelEnd; i++) {
    if (DOTTED_TUI_THEME_RE.test(lines[i]!)) {
      const rhs = lines[i]!.replace(DOTTED_TUI_THEME_RE, "");
      if (parseTomlStringValue(rhs) === theme) return null;
      lines[i] = rewriteThemeValue(lines[i]!, theme);
      return joinPreserve(lines, input);
    }
  }

  const sep = input.includes("\r\n") ? "\r\n" : "\n";
  let base = input;
  if (!/\r?\n$/.test(base)) base += sep;
  return `${base}${sep}[tui]${sep}theme = "${theme}"${sep}`;
}
