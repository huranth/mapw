import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "../src/store/SettingsStore.js";
import { DEFAULT_SETTINGS, type SavedLayout } from "../src/types.js";

async function freshStorePath(): Promise<string> {
  const dir = join(
    tmpdir(),
    `mapw-test-${process.pid}-${Math.random().toString(36).slice(2)}`
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

  it("savedLayouts round-trips through update() + reload, preserving array-splice semantics + the per-node cliId field", async () => {
    const path = await freshStorePath();
    cleanup.push(path);
    const store = new SettingsStore({ path });
    await store.ensureLoaded();

    // First save — one user-saved layout with a CLI binding on its pane.
    const layoutA: SavedLayout = {
      id: "usr-a",
      name: "Layout A",
      nodes: [
        {
          paneId: "p1",
          cwd: "/proj",
          position: { x: 0, y: 0 },
          cliId: "codex",
        },
      ],
    };
    await store.update({ savedLayouts: [layoutA] });
    expect(store.get("savedLayouts")).toEqual([layoutA]);

    // Second save — the read-modify-write path layouts.ts uses: thread the
    // prior array through + append. SettingsStore's shallow top-level merge
    // REPLACES arrays (doesn't deep-merge), so the caller is the splice
    // authority; assert that the array order survives the write intact.
    const layoutB: SavedLayout = {
      id: "usr-b",
      name: "Layout B",
      nodes: [
        {
          paneId: "p2",
          cwd: null,
          position: { x: 1, y: 0 },
          cliId: "claude",
        },
      ],
    };
    const prior = store.get("savedLayouts") ?? [];
    await store.update({ savedLayouts: [...prior, layoutB] });
    expect(store.get("savedLayouts")).toEqual([layoutA, layoutB]);

    // A fresh instance over the same file should see both saved layouts (the
    // atomic temp-file-then-rename write + JSON round-trip preserves the
    // cliId field on every node — the field layouts.apply + TerminalPane's
    // auto-launch primitive both rely on).
    const reloaded = new SettingsStore({ path });
    await reloaded.ensureLoaded();
    const reloadedLayouts = reloaded.get("savedLayouts") ?? [];
    expect(reloadedLayouts).toEqual([layoutA, layoutB]);
    expect(reloadedLayouts[0]?.nodes[0]?.cliId).toBe("codex");
    expect(reloadedLayouts[1]?.nodes[0]?.cliId).toBe("claude");

    // A save AFTER reload splices into the freshly-loaded array correctly.
    const layoutC: SavedLayout = {
      id: "usr-c",
      name: "Layout C",
      nodes: [
        {
          paneId: "p3",
          cwd: null,
          position: { x: 2, y: 0 },
          cliId: "opencode",
        },
      ],
    };
    const priorAfterReload = reloaded.get("savedLayouts") ?? [];
    await reloaded.update({ savedLayouts: [...priorAfterReload, layoutC] });
    expect(reloaded.get("savedLayouts")).toEqual([layoutA, layoutB, layoutC]);

    // Untouched fields stay at their DEFAULT_SETTINGS values (the spread-on-
    // read keeps new top-level fields upgrade-safe for pre-feature files).
    expect(reloaded.get("theme")).toBe(DEFAULT_SETTINGS.theme);
  });
});
