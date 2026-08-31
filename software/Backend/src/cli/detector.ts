import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { CURATED_CLIS } from "./types.js";
import type { DetectedCliTool, DetectCliToolsResult } from "./types.js";

function delimiter(): string { return process.platform === "win32" ? ";" : ":"; }
function extensions(): readonly string[] {
  if (process.platform !== "win32") return [""];
  const raw = process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT";
  return raw.split(";").map((e) => e.toLowerCase()).filter(Boolean);
}

export class CliToolDetector {
  async detect(): Promise<DetectCliToolsResult> {
    const pathEnv = process.env["PATH"] ?? "";
    const dirs = pathEnv.split(delimiter()).map((d) => d.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
    const exts = extensions();
    const check = process.platform === "win32" ? constants.F_OK : constants.X_OK;
    const found: DetectedCliTool[] = [];
    for (const cli of CURATED_CLIS) {
      for (const dir of dirs) {
        let resolved: string | null = null;
        for (const ext of exts) {
          const candidate = join(dir, `${cli.binary}${ext}`);
          try { await access(candidate, check); resolved = candidate; break; } catch {}
        }
        if (resolved) { found.push({ id: cli.id, name: cli.name, binary: cli.binary, launchCommand: cli.launchCommand, path: resolved }); break; }
      }
    }
    return { tools: found };
  }
}
