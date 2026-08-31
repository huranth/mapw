import { describe, expect, it } from "vitest";
import { buildSwapScript, isNewerVersion, parseLatestJson } from "../electron/updateMeta";

describe("isNewerVersion", () => {
  it("detects higher versions", () => {
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.1.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(true);
  });

  it("rejects equal and lower versions", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(false);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(false);
  });

  it("tolerates v-prefixes, missing parts, and prerelease tags", () => {
    expect(isNewerVersion("1.0", "v1.0.1")).toBe(true);
    expect(isNewerVersion("v1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.0.1-beta.2")).toBe(true);
    // Prerelease tags don't count as higher by themselves.
    expect(isNewerVersion("1.0.0", "1.0.0-beta")).toBe(false);
  });
});

describe("parseLatestJson", () => {
  const good = JSON.stringify({
    version: "1.2.3",
    url: "https://example.com/mapw-1.2.3.exe",
    notes: "bug fixes",
    publishedAt: "2026-08-29T00:00:00Z",
  });

  it("accepts a well-formed release", () => {
    expect(parseLatestJson(good)).toEqual({
      version: "1.2.3",
      url: "https://example.com/mapw-1.2.3.exe",
      notes: "bug fixes",
      publishedAt: "2026-08-29T00:00:00Z",
    });
  });

  it("rejects missing fields, non-https URLs, and malformed JSON", () => {
    expect(parseLatestJson("{\"version\":\"1.0.0\"}")).toBeNull();
    expect(parseLatestJson("{\"version\":\"1.0.0\",\"url\":\"http://insecure/x.exe\"}")).toBeNull();
    expect(parseLatestJson("not json at all")).toBeNull();
    expect(parseLatestJson("42")).toBeNull();
  });
});

describe("buildSwapScript", () => {
  it("waits for exit, swaps, and relaunches", () => {
    const script = buildSwapScript("C:\\temp\\mapw-1.1.0.exe", "C:\\apps\\mapw.exe");
    expect(script).toContain("Move-Item -Force $new $target");
    expect(script).toContain("Start-Process $target");
    expect(script).toContain("Start-Sleep");
  });

  it("escapes single quotes in paths", () => {
    const script = buildSwapScript("C:\\o'brien\\new.exe", "C:\\o'brien\\app.exe");
    expect(script).toContain("C:\\o''brien\\new.exe");
    expect(script).not.toContain("C:\\o'brien\\new.exe");
  });
});
