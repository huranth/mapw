// Auto-update for mapw's portable Windows build.
// Flow on every launch (and every 30 min while running):
//   fetch latest.json from the public `releases` storage bucket →
//   if newer than the running version → download the exe to temp →
//   stage a swap script → on quit the script replaces the exe and relaunches.
// Portable Electron exes can't replace themselves while running, so the
// swap-in is done by a detached PowerShell one-liner after process exit.
// Dev runs (unpackaged electron.exe) never self-update.
import { app } from "electron";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { UpdateProgress } from "@bridgespace/backend";
import {
  buildSwapScript,
  isNewerVersion,
  parseLatestJson,
  type LatestRelease,
} from "./updateMeta";

export type { LatestRelease } from "./updateMeta";
export { buildSwapScript, isNewerVersion, parseLatestJson } from "./updateMeta";

function supabaseOrigin(): string {
  const fromEnv = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim().replace(/\/+$/, "");
  return "";
}
export const RELEASES_INDEX_URL = (() => {
  const o = supabaseOrigin();
  return o ? `${o}/storage/v1/object/public/releases/latest.json` : "";
})();

const DOWNLOAD_LIMIT_BYTES = 600 * 1024 * 1024;

async function fetchLatestRelease(): Promise<LatestRelease | null> {
  if (!RELEASES_INDEX_URL) return null;
  // Retry with backoff for transient network failures
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(RELEASES_INDEX_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        if (res.status >= 500 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
          continue;
        }
        return null;
      }
      const text = await res.text();
      const parsed = parseLatestJson(text);
      if (!parsed) return null;
      // Extra guard: url must be https + supabase storage releases path
      if (!isAllowedReleaseUrl(parsed.url) || !parsed.url.includes("/storage/v1/object/public/releases/")) return null;
      return parsed;
    } catch (err) {
      if (attempt === 2) {
        console.debug("[updater] fetchLatestRelease failed:", err);
        return null;
      }
      await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
    }
  }
  return null;
}

function isAllowedReleaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".supabase.co") && u.pathname.includes("/storage/v1/object/public/releases/");
  } catch { return false; }
}

async function downloadRelease(
  url: string,
  dest: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  if (!isAllowedReleaseUrl(url)) throw new Error("blocked untrusted release url");
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  let lastReport = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > DOWNLOAD_LIMIT_BYTES) {
        controller.error(new Error("download exceeds size limit"));
        return;
      }
      if (total > 0 && received - lastReport > total / 20) {
        lastReport = received;
        onProgress(received, total);
      }
      controller.enqueue(chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(res.body.pipeThrough(counter) as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(dest),
  );
  onProgress(total > 0 ? total : received, total > 0 ? total : received);
}

export interface UpdateContext {
  isPackaged: boolean;
  currentVersion: string;
  onStatus: (status: UpdateProgress) => void;
  /** Called once the new exe is fully staged; main registers quit-time apply. */
  onStaged: (applyOnQuit: () => void) => void;
}

export async function runUpdateCycle(ctx: UpdateContext): Promise<void> {
  try {
    ctx.onStatus({ phase: "checking" });
    const release = await fetchLatestRelease();
    if (!release || !isNewerVersion(ctx.currentVersion, release.version)) {
      ctx.onStatus({ phase: "up-to-date" });
      return;
    }
    ctx.onStatus({ phase: "available", version: release.version });

    const workDir = join(tmpdir(), `mapw-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(workDir, { recursive: true });
    const exePath = join(workDir, `mapw-${release.version}.exe`);
    // Download with one retry on transient failure
    try {
      await downloadRelease(release.url, exePath, (receivedBytes, totalBytes) => {
        ctx.onStatus({ phase: "downloading", version: release.version, receivedBytes, totalBytes });
      });
    } catch (err) {
      // one retry after 800ms
      await new Promise((r) => setTimeout(r, 800));
      await downloadRelease(release.url, exePath, (receivedBytes, totalBytes) => {
        ctx.onStatus({ phase: "downloading", version: release.version, receivedBytes, totalBytes });
      });
    }

    const applyOnQuit = (): void => {
      const scriptPath = exePath.replace(/\.exe$/, "-swap.ps1");
      void writeFile(scriptPath, buildSwapScript(exePath, process.execPath), "utf8")
        .then(() => {
          try {
            const child = spawn(
              "powershell.exe",
              ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath],
              { detached: true, stdio: "ignore", windowsHide: true },
            );
            child.unref();
          } catch (err) {
            console.error("[updater] spawn failed:", err);
          }
        })
        .catch((err) => console.error("[updater] swap script write failed:", err));
    };
    ctx.onStaged(applyOnQuit);
    ctx.onStatus({ phase: "staged", version: release.version });
  } catch (error) {
    ctx.onStatus({
      phase: "error",
      message: error instanceof Error ? error.message : "update failed",
    });
  }
}

export function isSelfUpdatePossible(): boolean {
  return app.isPackaged && process.platform === "win32";
}
