// Detected-CLI surface — the shape the renderer + main process share for the
// famous-CLI chip strip on every pane header. At app boot the main process
// scans PATH for the curated list below (see `CURATED_CLIS`) and returns the
// subset actually installed on the user's machine; the renderer's
// `useCliToolsStore` (Frontend/src/stores/cliTools.ts) drives the per-pane
// chip strip rendering from that list.
//
// Layout contract: a CLI's `launchCommand` is exactly what gets written to a
// pane's shell stdin as `${launchCommand}\r` when the user clicks the chip in
// the pane header — same primitive the old hardcoded `"opencode\r"` auto-
// launch in TerminalPane.tsx used (TerminalPane.tsx:173 prior to this change).
//
// The detector itself lives in `./detector.ts` (Node-only — imports
// `node:fs/promises` + `node:path`); the shape below is renderer-safe (zero
// Node imports), so it's re-exported from BOTH `Backend/src/index.ts` (main
// surface) AND `Backend/src/renderer.ts` (browser-safe subpath).

export interface DetectedCliTool {
  /** Stable id — used as the React key in the chip strip. Same as `binary`
   *  today, kept distinct so a future CLI whose product id diverges from its
   *  binary name (e.g. a hypothetical `chatgpt-cli` whose binary is `gpt`)
   *  stays decodable without touching the renderer. */
  readonly id: string;
  /** Display label rendered inside the pane-header chip. Matches the binary
   *  name (opencode, claude, aider, ...) — lowercase mono reads as another
   *  of the chrome's technical glyphs, matching the existing Copy/Close
   *  recipe in TerminalNode's header. */
  readonly name: string;
  /** Bare binary file name searched for on PATH (no extension; the detector
   *  appends `.exe` / `.cmd` / `.bat` on Windows per PATHEXT — see
   *  `CliToolDetector.detect`). */
  readonly binary: string;
  /** The exact string written to the pane's shell stdin to launch this CLI.
   *  Identical to `binary` for every curated row today; kept as a separate
   *  field so a CLI launched via `npx <name>` or with shell-only argv flags
   *  can be added later without changing the chip click handler. */
  readonly launchCommand: string;
  /** Absolute on-disk path to the binary the detector resolved. Surface
   *  only today — the renderer doesn't parse it. Lets a future "Show in
   *  Explorer" affordance resolve the install location without re-scanning
   *  PATH. */
  readonly path: string;
}

export interface DetectCliToolsResult {
  /** Subset of the curated table that the detector actually found on PATH.
   *  Order matches `CURATED_CLIS`, NOT PATH order — so the chip strip's
   *  left-to-right layout is stable across machines. Empty array if PATH
   *  itself is missing or no curated CLI is installed. */
  readonly tools: DetectedCliTool[];
}

/** The curated table of famous AI/agentic CLIs the chip strip advertises. A
 *  CLI renders as a chip ONLY when the detector finds its binary on PATH at
 *  app boot — so a fresh machine with only opencode installed shows a
 *  one-element strip instead of six ghost chips that 404 on click.
 *
 *  Extensible: add a row here and the detector + UI adapt automatically. */
export const CURATED_CLIS: readonly {
  readonly id: string;
  readonly name: string;
  readonly binary: string;
  readonly launchCommand: string;
}[] = [
  { id: "opencode", name: "opencode", binary: "opencode", launchCommand: "opencode" },
  { id: "claude", name: "claude", binary: "claude", launchCommand: "claude" },
  { id: "aider", name: "aider", binary: "aider", launchCommand: "aider" },
  { id: "codex", name: "codex", binary: "codex", launchCommand: "codex" },
  { id: "gemini", name: "gemini", binary: "gemini", launchCommand: "gemini" },
  { id: "amp", name: "amp", binary: "amp", launchCommand: "amp" },
];
