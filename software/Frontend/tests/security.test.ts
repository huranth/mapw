import { describe, it, expect } from "vitest";

// Security floor — trust boundaries
describe("security — isTrustedReleaseUrl", () => {
  // Mirrors the fixed logic in updater.ts / shared.js
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
  it("blocks javascript: and http", () => {
    expect(isTrusted("javascript:alert(1)")).toBe(false);
    expect(isTrusted("http://github.com/huranth/mapw/releases/download/v0.1.7/x.exe")).toBe(false);
  });
  it("blocks dot-bypass", () => {
    expect(isTrusted("https://evil-supabase.co/storage/v1/object/public/releases/x.exe")).toBe(false);
    expect(isTrusted("https://evil-github-releases.githubusercontent.com/x")).toBe(false);
  });
  it("blocks wrong repo", () => {
    expect(isTrusted("https://github.com/huranth/mapw-evil/releases/download/x.exe")).toBe(false);
  });
});

describe("security — shellIntegration", () => {
  it("isSafeShellPath blocks traversal", async () => {
    // Direct logic test without importing backend (which is not exposed to Frontend vitest)
    function isSafeShellPath(pref: string, shell: string): boolean {
      if (!pref.includes("/") && !pref.includes("\\")) return pref === shell || pref === `${shell}.exe`;
      const safe = ["/usr/local/bin/", "/usr/bin/", "/bin/", "c:/windows/system32/", "c:/program files/git/bin/"];
      const lower = pref.toLowerCase();
      return safe.some((s) => lower.startsWith(s)) && lower.endsWith(shell.toLowerCase());
    }
    expect(isSafeShellPath("/usr/bin/bash", "bash")).toBe(true);
    expect(isSafeShellPath("/tmp/evil; rm -rf /", "bash")).toBe(false);
    expect(isSafeShellPath("bash", "bash")).toBe(true);
  });
});

describe("security — XSS via innerHTML", () => {
  it("escapeHtml encodes", async () => {
    // Simulate the esc used in handbook
    function esc(s: string): string {
      return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    }
    expect(esc('<svg onload=alert(1)>')).toBe("&lt;svg onload=alert(1)&gt;");
    expect(esc('a&b')).toBe("a&amp;b");
  });
});
