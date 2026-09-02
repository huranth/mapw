import { describe, it, expect } from "vitest";

// Copy of the fixed isAllowedReleaseUrl for isolated test (mirrors updater.ts and shared.js)
function isTrusted(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    if (host === "pdynfowdtiulrllqetbl.supabase.co" && path.includes("/storage/v1/object/public/releases/")) return true;
    if (host === "github.com" && (path.startsWith("/huranth/mapw/releases/") || path.startsWith("/huranth/mapw-releases/releases/"))) return true;
    return false;
  } catch { return false; }
}

describe("isTrustedReleaseUrl / isAllowedReleaseUrl — strict allowlist", () => {
  const ok = [
    "https://pdynfowdtiulrllqetbl.supabase.co/storage/v1/object/public/releases/latest.json",
    "https://pdynfowdtiulrllqetbl.supabase.co/storage/v1/object/public/releases/mapw-0.1.7.exe",
    "https://github.com/huranth/mapw/releases/download/v0.1.7/mapw-setup-0.1.7.exe",
    "https://github.com/huranth/mapw-releases/releases/download/v0.1.7/mapw-setup-0.1.7.exe",
  ];
  const bad = [
    "https://evil-supabase.co/storage/v1/object/public/releases/mapw.exe",
    "https://evil-githubusercontent.com/releases/mapw.exe",
    "https://evil-github-releases.githubusercontent.com/evil",
    "https://release-assets.githubusercontent.com/github-production-release-asset/xxx",
    "https://avatars.githubusercontent.com/u/1",
    "https://github.com/huranth/mapw-evil/releases/download/v0.0.1/evil.exe",
    "http://pdynfowdtiulrllqetbl.supabase.co/storage/v1/object/public/releases/latest.json",
    "https://github.com/huranth/mapw",
    "javascript:alert(1)",
    "https://pdynfowdtiulrllqetbl.supabase.co/storage/v1/object/private/releases/mapw.exe",
  ];
  for (const url of ok) it(`allows ${url}`, () => expect(isTrusted(url)).toBe(true));
  for (const url of bad) it(`blocks ${url}`, () => expect(isTrusted(url)).toBe(false));
});
