import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "../src/store/SettingsStore.js";
import { DEFAULT_SETTINGS } from "../src/types.js";

async function freshStorePath(): Promise<string> {
  const dir = join(
    tmpdir(),
    `bs-test-${process.pid}-${Math.random().toString(36).slice(2)}`
  );
  return join(dir, "settings.json");
}

const cleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length) {
    const path = cleanup.pop()!;
    await rm(path, { recursive: true, force: true }).catch(() => {});
  }
});

describe("SettingsStore", () => {
  it("falls back to DEFAULT_SETTINGS when file is missing", async () => {
    const path = await freshStorePath();
    cleanup.push(path);
    const store = new SettingsStore({ path });
    await store.ensureLoaded();
    expect(store.getAll()).toEqual(DEFAULT_SETTINGS);
    expect(store.get("theme")).toBe(DEFAULT_SETTINGS.theme);
    expect(store.get("scrollbackLines")).toBe(10000);
  });

  it("update() merges partial fields and persists to disk", async () => {
    const path = await freshStorePath();
    cleanup.push(path);
    const store = new SettingsStore({ path });
    await store.ensureLoaded();

    const next = await store.update({ theme: "paper", fontSize: 16 });
    expect(next.theme).toBe("paper");
    expect(next.fontSize).toBe(16);

    // A fresh instance over the same file should see the saved values.
    const reloaded = new SettingsStore({ path });
    await reloaded.ensureLoaded();
    expect(reloaded.get("theme")).toBe("paper");
    expect(reloaded.get("fontSize")).toBe(16);
    // Untouched fields retain defaults.
    expect(reloaded.get("fontFamily")).toBe(DEFAULT_SETTINGS.fontFamily);
  });

  it("reads an existing file on first ensureLoaded", async () => {
    const path = await freshStorePath();
    cleanup.push(path);
    const seed = new SettingsStore({ path });
    await seed.ensureLoaded();
    await seed.update({ shell: "pwsh", theme: "storm" });

    const reader = new SettingsStore({ path });
    await reader.ensureLoaded();
    expect(reader.get("shell")).toBe("pwsh");
    expect(reader.get("theme")).toBe("storm");
  });

  it("reset() restores defaults and rewrites the file", async () => {
    const path = await freshStorePath();
    cleanup.push(path);
    const store = new SettingsStore({ path });
    await store.ensureLoaded();
    await store.update({ theme: "paper", scrollbackLines: 5000 });

    const restored = await store.reset();
    expect(restored).toEqual(DEFAULT_SETTINGS);

    const reloaded = new SettingsStore({ path });
    await reloaded.ensureLoaded();
    expect(reloaded.get("theme")).toBe(DEFAULT_SETTINGS.theme);
    expect(reloaded.get("scrollbackLines")).toBe(DEFAULT_SETTINGS.scrollbackLines);
  });

  it("overrides seed defaults and win over stored values until rewrite", async () => {
    const path = await freshStorePath();
    cleanup.push(path);
    const store = new SettingsStore({ path, overrides: { theme: "storm" } });
    await store.ensureLoaded();
    expect(store.get("theme")).toBe("storm");
  });
});
