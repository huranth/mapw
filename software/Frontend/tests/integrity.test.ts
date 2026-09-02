import { describe, it, expect } from "vitest";
import { parseLatestJson, isNewerVersion } from "@/../electron/updateMeta";
import { createHash } from "node:crypto";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("integrity — updateMeta", () => {
  it("parseLatestJson validates sha256 and size", () => {
    const raw = JSON.stringify({
      version: "0.1.7",
      url: "https://github.com/huranth/mapw-releases/releases/download/v0.1.7/mapw-setup-0.1.7.exe",
      sha256: "a".repeat(64),
      size: 88118109,
    });
    const parsed = parseLatestJson(raw)!;
    expect(parsed.sha256).toBe("a".repeat(64));
    expect(parsed.size).toBe(88118109);

    const bad = JSON.stringify({ version: "0.1.7", url: "https://github.com/huranth/mapw/releases/download/v0.1.7/x.exe", sha256: "not-hex" });
    expect(parseLatestJson(bad)!.sha256).toBeUndefined();

    const missing = JSON.stringify({ version: "0.1.7" });
    expect(parseLatestJson(missing)).toBeNull();
  });

  it("isNewerVersion handles semver", () => {
    expect(isNewerVersion("0.1.6", "0.1.7")).toBe(true);
    expect(isNewerVersion("0.1.7", "0.1.6")).toBe(false);
    expect(isNewerVersion("0.1.7", "0.1.7")).toBe(false);
    expect(isNewerVersion("v0.1.6", "0.1.7")).toBe(true);
    expect(isNewerVersion("0.1.7-beta", "0.1.7")).toBe(false);
  });

  it("sha256 verification — detects tamper", async () => {
    const tmp = join(tmpdir(), `mapw-integrity-${Date.now()}.bin`);
    const content = Buffer.from("hello mapw");
    await writeFile(tmp, content);
    const hash = createHash("sha256").update(content).digest("hex");
    // verify helper (mirrors updater.ts verifySha256)
    async function verifySha256(filePath: string, expected: string) {
      const h = createHash("sha256");
      const data = await readFile(filePath);
      h.update(data);
      const actual = h.digest("hex").toLowerCase();
      if (actual !== expected.toLowerCase()) throw new Error(`checksum mismatch`);
    }
    await expect(verifySha256(tmp, hash)).resolves.toBeUndefined();
    await expect(verifySha256(tmp, "0".repeat(64))).rejects.toThrow(/mismatch/);
    await unlink(tmp).catch(() => {});
  });
});
