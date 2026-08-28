// CliToolDetector — singleton service that resolves the user's actually-
// installed AI/agentic CLIs from the curated table in `./types.ts` by walking
// PATH (split on `;` Win / `:` POSIX) and PATHEXT (the canonical Windows
// executable-extensions list). Pure filesystem probing — no `which` shell-out,
// no `child_process`. The check is `fs.access(candidate, X_OK)`: on Windows
// this validates existence + executable bit; we don't gate on actually being
// able to execute since the calling context (pane shell) can defer that — the
// user clicks the chip, the shell tries to launch, and any startup error
// surfaces inline in the pane itself instead of bouncing through a separate
// IPC error channel.
//
// The result is cached per instance: the main process holds ONE
// CliToolDetector for the app's lifetime (see `getCliDetector` in
// `Frontend/electron/main.ts`) so subsequent IPC calls return the memoized
// scan without re-walking PATH. A PATH change mid-session is rare enough that
// re-scanning never buys much, and the chip strip would not repaint mid-
// flight anyway (re-render happens only on next Workspace mount).
//
// Node-only — imports `node:fs/promises` + `node:path`. Re-exported from
// `Backend/src/index.ts` (main surface) but DELIBERATELY NOT from
// `Backend/src/renderer.ts` (browser-safe surface — would pull Node APIs into
// the renderer bundle).

import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { CURATED_CLIS } from "./types.js";
import type { DetectedCliTool, DetectCliToolsResult } from "./types.js";

/** Windows splits PATH entries with `;`; POSIX with `:`. */
const PATH_DELIMITER = process.platform === "win32" ? ";" : ":";

/** Returns the candidate executable extensions to probe per PATH dir.
 *  - Windows: PATHEXT is the canonical list (typically
 *    `.COM;.EXE;.BAT;.CMD;.VBS;...`). Lowercased so the case-insensitive FS
 *    lookup matches user-installed CLIs regardless of how the installer
 *    named the binary file on disk.
 *  - POSIX: there is no PATHEXT convention — only the bare binary name is
 *    consulted, so we return a single empty-string extension and `join(dir,
 *    `\`${binary}\${""}\`)` resolves to the bare binary path. */
function executableExtensions(): readonly string[] {
  if (process.platform === "win32") {
    const raw = process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT";
    return raw
      .split(";")
      .map((ext) => ext.toLowerCase())
      .filter((ext) => ext.length > 0);
  }
  return [""];
}

export class CliToolDetector {
  /** Memoized scan result — `null` until the first `detect()` call resolves.
   *  The main process holds one detector instance for the app's life so
   *  subsequent IPC calls return the cached array without re-walking PATH. */
  private cache: DetectCliToolsResult | null = null;

  async detect(): Promise<DetectCliToolsResult> {
    if (this.cache) return this.cache;
    const pathEnv = process.env["PATH"] ?? "";
    const dirs = pathEnv.split(PATH_DELIMITER).filter((dir) => dir.length > 0);
    const exts = executableExtensions();
    const found: DetectedCliTool[] = [];
    for (const cli of CURATED_CLIS) {
      for (const dir of dirs) {
        let resolved: string | null = null;
        for (const ext of exts) {
          const candidate = join(dir, `${cli.binary}${ext}`);
          try {
            await access(candidate, constants.X_OK);
            resolved = candidate;
            break;
          } catch {
            // not present / not executable — try the next extension.
          }
        }
        if (resolved !== null) {
          found.push({
            id: cli.id,
            name: cli.name,
            binary: cli.binary,
            launchCommand: cli.launchCommand,
            path: resolved,
          });
          break; // first PATH dir that has it wins — PATH semantics.
        }
      }
    }
    this.cache = { tools: found };
    return this.cache;
  }
}
