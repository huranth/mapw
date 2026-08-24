// useCliToolsStore — the renderer-side cache of main's curated-CLI scan.
// Mirrors useSettingsStore's ensureLoaded/reload contract: one IPC per
// lifetime is latched via `loaded`; a thrown reload falls through to an
// empty list (best-effort — the workspace flow doesn't gate on this store).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Bridge } from "@/bridge/types";
import { makeTestBridge } from "../setupTests";

function installBridge(overrides: Partial<Bridge> = {}): Bridge {
  const full = makeTestBridge(overrides);
  (window as unknown as { bridge: Bridge }).bridge = full;
  return full;
}

beforeEach(() => {
  // Each test gets a fresh store module so the `loaded` latch from a
  // previous test can't leak forward (zustand module-level singletons
  // persist otherwise).
  vi.resetModules();
});

describe("useCliToolsStore", () => {
  it("starts unloaded with an empty curated list", async () => {
    installBridge({});
    const { useCliToolsStore } = await import("@/stores/cliTools");
    const { result } = renderHook(() => useCliToolsStore());
    expect(result.current.cliTools).toEqual([]);
    expect(result.current.loaded).toBe(false);
  });

  it("ensureLoaded pulls the curated CLI list through the detectCliTools IPC exactly once", async () => {
    const detect = vi.fn(async () => ({
      tools: [
        {
          id: "opencode",
          name: "opencode",
          binary: "opencode",
          launchCommand: "opencode",
          path: "/usr/local/bin/opencode",
        },
      ],
    }));
    installBridge({ detectCliTools: detect });
    const { useCliToolsStore } = await import("@/stores/cliTools");
    const { result } = renderHook(() => useCliToolsStore());
    await act(async () => {
      await result.current.ensureLoaded();
    });
    expect(detect).toHaveBeenCalledTimes(1);
    expect(result.current.loaded).toBe(true);
    expect(result.current.cliTools).toHaveLength(1);
    expect(result.current.cliTools[0]?.id).toBe("opencode");
  });

  it("ensureLoaded is idempotent — subsequent calls do not re-IPC", async () => {
    const detect = vi.fn(async () => ({ tools: [] }));
    installBridge({ detectCliTools: detect });
    const { useCliToolsStore } = await import("@/stores/cliTools");
    const { result } = renderHook(() => useCliToolsStore());
    await act(async () => {
      await result.current.ensureLoaded();
      await result.current.ensureLoaded();
    });
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("a thrown IPC scan falls through to an empty list + latched loaded (best-effort, no block, no retry storm)", async () => {
    const detect = vi.fn(async () => {
      throw new Error("scan broken");
    });
    installBridge({ detectCliTools: detect });
    const { useCliToolsStore } = await import("@/stores/cliTools");
    const { result } = renderHook(() => useCliToolsStore());
    await act(async () => {
      await result.current.ensureLoaded();
      // Second ensureLoaded should NOT re-IPC — the latch blocks retry even
      // on a thrown previous attempt, so a misbehaving detector can't
      // hammer an IPC in a tight loop.
      await result.current.ensureLoaded();
    });
    expect(detect).toHaveBeenCalledTimes(1);
    expect(result.current.cliTools).toEqual([]);
    expect(result.current.loaded).toBe(true);
  });
});
