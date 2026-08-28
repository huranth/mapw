// Pure-logic tests for the codex config.toml `[tui].theme` merge — the
// effectful wrapper (`Frontend/electron/codexThemeSeeder.ts`) is best-effort +
// fs-only, so the entire correctness surface lives in this pure function. We
// import from the electron main-process module directly: `codexThemeMerge.ts`
// is deliberately side-effect-free (no `node:fs` / `node:os`), so it loads
// cleanly under the Frontend jsdom env. Mirrors how `Backend` keeps its
// `shellIntegration` rc builders pure for the same testability reason.

import { describe, expect, it } from "vitest";
import {
  CODEX_TARGET_THEME,
  mergeTuiThemeIntoToml,
} from "../electron/codexThemeMerge";

const T = CODEX_TARGET_THEME; // "catppuccin-latte"

// A faithful-shape (NOT the user's real secrets) fixture mirroring the actual
// ~/.codex/config.toml structure the seeder must not mangle: top-level model
// keys (incl. the `model_catalog_json` "must stay above the first [section]"
// constraint), a Lingling model-providers block, per-project trust levels,
// a hooks.state block, and a trailing [windows] section. No [tui] section.
const LINGLING_FIXTURE = [
  "# Lingling gateway (generated: backend/tools/codex_catalog.py + README)",
  "# model_catalog_json must stay above the first [section] header -- TOML",
  "# scopes any key below a header to that section, and Codex reads it top level.",
  'model_provider = "lingling"',
  'model = "muse-spark"',
  'model_catalog_json = "C:/Users/W/.codex/lingling_models.json"',
  'model_reasoning_effort = "xhigh"',
  "",
  'notify = ["node", "bs-agent-notify.cjs", "--agent", "codex"]',
  "",
  "[model_providers.lingling]",
  'name = "Lingling"',
  'base_url = "http://127.0.0.1:8000/v1"',
  'wire_api = "responses"',
  'env_key = "LINGLING_API_KEY"',
  "",
  "[projects.'c:\\\\users\\\\w\\\\desktop\\\\my taste']",
  'trust_level = "trusted"',
  "",
  "[hooks.state]",
  "",
  "[hooks.state.'C:\\\\Users\\\\W\\\\.codex\\\\hooks.json:stop:0:0']",
  'trusted_hash = "sha256:deadbeef"',
  "",
  "[windows]",
  'sandbox = "elevated"',
].join("\n");

describe("mergeTuiThemeIntoToml — fresh / append path (levers + idempotency)", () => {
  it("emits a minimal `[tui]` section for an empty (never-run) config", () => {
    expect(mergeTuiThemeIntoToml("", T)).toBe(`[tui]\ntheme = "${T}"\n`);
  });

  it("appends `[tui]` at the END, preserving every original line verbatim", () => {
    const res = mergeTuiThemeIntoToml(LINGLING_FIXTURE, T);
    expect(res).not.toBeNull();
    const out = res!;
    for (const line of LINGLING_FIXTURE.split("\n")) {
      expect(out).toContain(line);
    }
    // The new section lands at the very end (after [windows]).
    expect(out.endsWith(`[tui]\ntheme = "${T}"\n`)).toBe(true);
    // The documented top-level scoping constraint survives: model_catalog_json
    // is still ABOVE the first `[section]` header in the output.
    const outLines = out.split("\n");
    const catalogIdx = outLines.findIndex((l) =>
      l.startsWith("model_catalog_json"),
    );
    const firstHeaderIdx = outLines.findIndex((l) => /^\s*\[[^\]]+\]/.test(l));
    expect(catalogIdx).toBeGreaterThan(-1);
    expect(firstHeaderIdx).toBeGreaterThan(-1);
    expect(catalogIdx).toBeLessThan(firstHeaderIdx);
  });

  it("is idempotent against the user-shaped fixture (re-run is a no-op)", () => {
    const once = mergeTuiThemeIntoToml(LINGLING_FIXTURE, T)!;
    expect(mergeTuiThemeIntoToml(once, T)).toBeNull();
  });
});

describe("mergeTuiThemeIntoToml — existing `[tui]` section", () => {
  it("rewrites a different `theme` value, preserving sibling keys + other sections", () => {
    const input = [
      'model = "m"',
      "",
      "[tui]",
      'theme = "dracula"',
      "status_line_use_colors = true",
      "",
      "[windows]",
      'sandbox = "elevated"',
    ].join("\n");
    const out = mergeTuiThemeIntoToml(input, T)!;
    expect(out).toContain(`theme = "${T}"`);
    expect(out).not.toContain('theme = "dracula"');
    // sibling key preserved
    expect(out).toContain("status_line_use_colors = true");
    // other section + its key preserved
    expect(out).toContain('sandbox = "elevated"');
  });

  it("inserts a `theme` key right under the header when the section has none", () => {
    const input = ["[tui]", "status_line_use_colors = true", "[windows]"].join(
      "\n",
    );
    const out = mergeTuiThemeIntoToml(input, T)!;
    const lines = out.split("\n");
    const h = lines.indexOf("[tui]");
    expect(h).toBeGreaterThan(-1);
    expect(lines[h + 1]).toBe(`theme = "${T}"`);
    // the existing sibling stays right after the new line
    expect(lines[h + 2]).toBe("status_line_use_colors = true");
  });

  it("returns null when `[tui]` already carries the target theme", () => {
    expect(mergeTuiThemeIntoToml(`[tui]\ntheme = "${T}"\n`, T)).toBeNull();
  });

  it("ignores commented-out `theme =` and inserts a real one (comment kept)", () => {
    const input = [
      "[tui]",
      '# theme = "dark"',
      "status_line_use_colors = true",
      "[windows]",
    ].join("\n");
    const out = mergeTuiThemeIntoToml(input, T)!;
    expect(out).toContain(`theme = "${T}"`);
    expect(out).toContain('# theme = "dark"'); // comment untouched
  });

  it("does not confuse a `[tui.something]` sub-table with the `[tui]` table", () => {
    // A sub-table header is NOT the bare [tui] table -> no body found -> append
    // a fresh [tui]. ( Defence-in-depth: the exact-header regex rejects it. )
    const input = "[tui.padding]\nsize = 2\n[windows]\nsandbox = \"elevated\"\n";
    const out = mergeTuiThemeIntoToml(input, T)!;
    expect(out).toContain("[tui]");
    expect(out).toContain(`theme = "${T}"`);
    // the sub-table survives untouched
    expect(out).toContain("[tui.padding]");
    expect(out).toContain("size = 2");
  });
});

describe("mergeTuiThemeIntoToml — top-level dotted `tui.theme` bare key", () => {
  it("rewrites the dotted key in place (does NOT append a duplicate [tui] table)", () => {
    const input = [
      'model = "m"',
      'tui.theme = "dracula"', // top-level dotted bare key (scopes to tui table)
      "[windows]",
      'sandbox = "elevated"',
    ].join("\n");
    const out = mergeTuiThemeIntoToml(input, T)!;
    expect(out).toContain(`tui.theme = "${T}"`);
    expect(out).not.toContain('tui.theme = "dracula"');
    // Appending a [tui] here would create a duplicate tui-table definition ->
    // codex boot failure. Must NOT append.
    expect(out).not.toMatch(/^[ \t]*\[tui\][ \t]*(#.*)?$/m);
  });

  it("is idempotent when the dotted key already equals the target", () => {
    expect(mergeTuiThemeIntoToml(`tui.theme = "${T}"\n`, T)).toBeNull();
  });

  it("does NOT treat a `tui.theme` key BELOW a section as the tui table", () => {
    // `tui.theme` inside [other] scopes to `other.tui.theme`, not top-level
    // tui.theme — so there is no top-level dotted key; we append a fresh [tui].
    const input = 'model = "m"\n[other]\ntui.theme = "x"\n';
    const out = mergeTuiThemeIntoToml(input, T)!;
    expect(out).toContain("[tui]");
    expect(out).toContain(`theme = "${T}"`);
    // the [other].tui.theme line is left untouched (not top-level).
    expect(out).toContain('tui.theme = "x"');
  });
});

describe("mergeTuiThemeIntoToml — byte-fidelity", () => {
  it("preserves CRLF line endings on a value rewrite (no silent LF normalization)", () => {
    const input =
      "[tui]\r\ntheme = \"dracula\"\r\nstatus_line_use_colors = true\r\n";
    const out = mergeTuiThemeIntoToml(input, T)!;
    // Every newline in the output is a CRLF (a \n always preceded by \r).
    for (let i = 0; i < out.length; i++) {
      if (out[i] === "\n") expect(out[i - 1]).toBe("\r");
    }
    expect(out).toContain(`theme = "${T}"`);
  });

  it("round-trips the trailing-newline state on a rewrite", () => {
    const withTrailing = `[tui]\ntheme = "dracula"\n`;
    expect(mergeTuiThemeIntoToml(withTrailing, T)!.endsWith("\n")).toBe(true);
    const noTrailing = `[tui]\ntheme = "dracula"`;
    expect(mergeTuiThemeIntoToml(noTrailing, T)!.endsWith("\n")).toBe(false);
  });

  it("keeps the original key spacing style on a value rewrite", () => {
    // `theme   =    "x"` (wide spacing) -> spacing preserved, value swapped.
    const input = `[tui]\ntheme   =    "dracula"\n`;
    const out = mergeTuiThemeIntoToml(input, T)!;
    expect(out).toContain(`theme   =    "${T}"`);
  });
});
