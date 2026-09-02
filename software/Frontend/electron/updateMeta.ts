// Pure release-metadata helpers for the auto-updater — no Electron imports so
// vitest can exercise them. The Electron-dependent flow lives in updater.ts.

export interface LatestRelease {
  version: string;
  url: string;
  notes?: string;
  publishedAt?: string;
  sha256?: string;
  size?: number;
}

/** Strict semver-ish compare on dot-separated numeric parts; ignores prerelease tags. */
export function isNewerVersion(current: string, candidate: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/i, "")
      .split("-")[0]!
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(current);
  const b = parse(candidate);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Validate untrusted JSON from the bucket into a LatestRelease, or null. */
export function parseLatestJson(raw: string): LatestRelease | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const version = typeof data.version === "string" ? data.version : null;
    const url = typeof data.url === "string" ? data.url : null;
    if (!version || !url || !/^https:\/\//.test(url)) return null;
    const sha256 = typeof data.sha256 === "string" && /^[a-f0-9]{64}$/i.test(data.sha256) ? data.sha256.toLowerCase() : undefined;
    const size = typeof data.size === "number" && Number.isFinite(data.size) && data.size > 0 ? data.size : undefined;
    return {
      version,
      url,
      notes: typeof data.notes === "string" ? data.notes : undefined,
      publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : undefined,
      sha256,
      size,
    };
  } catch {
    return null;
  }
}

/**
 * PowerShell script that waits for the app process to exit, swaps the new exe
 * over the old one, and relaunches. Spawned detached at quit; a portable exe
 * cannot replace itself while running.
 */
export function buildSwapScript(exePath: string, targetPath: string): string {
  const quote = (p: string): string => "'" + p.replace(/'/g, "''") + "'";
  return [
    "$ErrorActionPreference = 'Stop'",
    `$new = ${quote(exePath)}`,
    `$target = ${quote(targetPath)}`,
    "for ($i = 0; $i -lt 30; $i++) {",
    "  try {",
    "    Move-Item -Force $new $target",
    "    break",
    "  } catch { Start-Sleep -Milliseconds 500 }",
    "}",
    "if (Test-Path $target) { Start-Process $target }",
  ].join("\r\n");
}
