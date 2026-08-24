// Pure, side-effect-free TOML text-merge that pins codex's `[tui].theme` to a
// light value WITHOUT a full TOML parse/stringify round-trip. A round-trip
// would drop comments + reformat the whole file — unacceptable for the user's
// `~/.codex/config.toml`, which carries the model provider (the "Lingling"
// gateway), per-project trust levels, hooks state, and explanatory comments
// (incl. a real constraint that `model_catalog_json` MUST stay above the first
// `[section]` header, since TOML scopes every key below a header to that
// section). We instead edit text surgically — leaving every other byte
// untouched — and the effectful wrapper (`codexThemeSeeder.ts`) writes the
// result atomically (tmp + rename, so no half-written file under any crash).
//
// Surfaced as a standalone pure module (no `node:fs` / `node:os` imports) so the
// full merge matrix is unit-testable in the node-environment vitest run without
// touching disk — mirroring how `Backend/src/pty/shellIntegration.ts` keeps its
// rc builders pure for the same reason.
//
// Cases handled (anything genuinely ambiguous bails as a no-write via the
// seeder's defensive try/catch, never mangling the file):
//   (1) empty input            -> emit a fresh minimal `[tui]\ntheme = "…"`
//   (2) `[tui]` header present:
//       * active `theme = "x"`  -> swap the value (a `catppuccin-latte` value
//                                  is a no-op); other `[tui]` keys + comments
//                                  are preserved verbatim
//       * no active `theme =`   -> insert one as the FIRST body line (right
//                                  under the header), leaving comments/other
//                                  keys where they are
//   (3) no `[tui]` header, but a top-level `tui.theme = "x"` dotted bare key
//       (valid TOML — scopes to the `tui` table without a header): swap its
//       value in place. Appending a `[tui]` section here would create a
//       DUPLICATE table definition -> codex parse error -> boot failure, so
//       this case is handled explicitly rather than falling through to append.
//   (4) neither -> append a `[tui]` section at end (after the user's existing
//       sections), behind one blank separator line. Appending at END (never
//       inserting above the first section header) is what keeps the
//       `model_catalog_json` top-level scoping constraint intact.
//
// codex's `theme` knob (kebab-case string; `codex-rs/config/src/types.rs`
// `Tui.theme`) selects the SYNTAX-highlighting theme. `catppuccin-latte` is
// codex's own adaptive-LIGHT default (`codex-rs/tui/src/render/highlight.rs`
// `adaptive_default_theme_selection`, chosen when its bg-probe reports a light
// terminal). Picking codex's bundled light default means zero extra `.tmTheme`
// files to ship to `$CODEX_HOME/themes`.

/** codex's own adaptive-light syntax theme name — the bundled light default. */
export const CODEX_TARGET_THEME = "catppuccin-latte";

// An EXACT `[tui]` header line (optional trailing comment). Crucially does NOT
// match sub-table headers like `[tui.foo]` (the `\]` must immediately follow
// `tui`), so a `[tui]` proper table is never confused with its sub-tables.
const TUI_HEADER_RE = /^[ \t]*\[tui\][ \t]*(#.*)?$/;

// ANY section/table header line — used only to find where a `[tui]` body ends
// (the line before the next header). A header always begins with `[` after
// optional whitespace, so this is a sound line-class test for that purpose.
const ANY_HEADER_RE = /^[ \t]*\[[^\]]+\]/;

// An active (non-commented) `theme =` assignment inside the `[tui]` body. A
// full-line comment (`# theme = …`) starts with `#` after the leading
// whitespace, so `^[ \t]*theme` does NOT match it — commented assignments are
// ignored (treated as "no active theme"), so we insert a real one rather than
// repainting a comment.
const THEME_KEY_RE = /^[ \t]*theme[ \t]*=[ \t]*/;

// A top-level `tui.theme = …` dotted bare key (no `[tui]` header). Only
// relevant in the pre-section region (a dotted key below a section header
// scopes to THAT section, not the top-level tui table — out of scope here).
const DOTTED_TUI_THEME_RE = /^[ \t]*tui\.theme[ \t]*=[ \t]*/;

// Matches the full `theme = ` / `tui.theme = ` prefix incl. its exact original
// spacing, used when rewriting the value in place so the user's whitespace style
// survives.
const THEME_ASSIGN_PREFIX_RE = /^[ \t]*(?:tui\.)?theme[ \t]*=[ \t]*/;

/** Extract the TOML string/bare value from the RHS of an assignment line
 *  (everything after `=`). Handles `"…"`, `'…'`, and bare tokens; ignores a
 *  trailing inline comment. Returns "" if nothing parseable — which simply
 *  means "not already seeded", so the caller will (re)write it. */
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

/** Replace the value of a `theme =` / `tui.theme =` line with `theme`, keeping
 *  the original key + spacing prefix. Any trailing inline comment on the line
 *  is dropped (a write that changes the theme is rare — only when the user
 *  explicitly set a different theme themselves — and losing an inline comment
 *  on that one line is the acceptable cost of a text-only, no-TOML-dep merge). */
function rewriteThemeValue(line: string, theme: string): string {
  const m = line.match(THEME_ASSIGN_PREFIX_RE);
  const prefix = m ? m[0] : "theme = ";
  return `${prefix}"${theme}"`;
}

/** Re-join the (possibly edited) line array preserving the original's line
 *  ending style. `String.prototype.split(/\r?\n/)` consumes both `\r\n` and
 *  `\n`; we emit the style the input used so a hand-authored CRLF file is not
 *  silently normalized to LF on a no-op-shaped write. */
function joinPreserve(lines: string[], original: string): string {
  const sep = original.includes("\r\n") ? "\r\n" : "\n";
  return lines.join(sep);
}

/**
 * Merge a top-level `[tui].theme = <theme>` assignment into a codex `config.toml`
 * body. Returns the new file text, or `null` when the file is already seeded
 * (no write needed — the seeder treats `null` as a skip). Idempotent by design:
 * feeding this function's own output back in yields `null`.
 */
export function mergeTuiThemeIntoToml(
  input: string,
  theme: string,
): string | null {
  if (input.length === 0) {
    // Fresh config — codex has never run here. A file containing ONLY the
    // theme section is valid TOML; codex fills in defaults for everything
    // else. LF endings (the Rust/writer default) on a file we author.
    return `[tui]\ntheme = "${theme}"\n`;
  }
  const lines = input.split(/\r?\n/);

  // --- Case (2): an exact `[tui]` header already exists. -------------------
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (TUI_HEADER_RE.test(lines[i]!)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx >= 0) {
    // Body ends at the next section header (any) — its sub-tables
    // (`[tui.foo]`) and unrelated tables both count as "body ends here".
    let bodyEnd = lines.length;
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (ANY_HEADER_RE.test(lines[i]!)) {
        bodyEnd = i;
        break;
      }
    }
    // First ACTIVE `theme =` line in the body.
    let themeIdx = -1;
    for (let i = headerIdx + 1; i < bodyEnd; i++) {
      if (THEME_KEY_RE.test(lines[i]!)) {
        themeIdx = i;
        break;
      }
    }
    if (themeIdx >= 0) {
      const rhs = lines[themeIdx]!.replace(THEME_KEY_RE, "");
      if (parseTomlStringValue(rhs) === theme) return null; // already seeded
      lines[themeIdx] = rewriteThemeValue(lines[themeIdx]!, theme);
      return joinPreserve(lines, input);
    }
    // No active theme key — insert one as the first body line (right under the
    // header), preserving whatever comments / sibling keys / blank lines were
    // already there. Splicing (not string-concat) keeps the offset math honest.
    lines.splice(headerIdx + 1, 0, `theme = "${theme}"`);
    return joinPreserve(lines, input);
  }

  // --- Case (3): no `[tui]` header, but a top-level `tui.theme =` dotted key. -
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

  // --- Case (4): neither — append a `[tui]` section at the END. -------------
  // Appending at end (after the user's existing sections) keeps the
  // `model_catalog_json` top-level-scoping constraint intact — that key stays
  // above the first `[section]` header where it already is. One blank
  // separator line precedes the new section; an original lacking a trailing
  // newline gets one added so `[tui]` starts on its own line.
  const sep = input.includes("\r\n") ? "\r\n" : "\n";
  let base = input;
  if (!/\r?\n$/.test(base)) base += sep;
  return `${base}${sep}[tui]${sep}theme = "${theme}"${sep}`;
}
