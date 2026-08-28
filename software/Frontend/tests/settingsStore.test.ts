import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { DEFAULT_SETTINGS, type Settings } from "@bridgespace/backend/renderer";
import type { Bridge, GetSettingsResponse } from "@/bridge/types";
import { makeTestBridge } from "../setupTests";

function installBridge(overrides: Partial<Bridge> = {}): Bridge {
  const full = makeTestBridge(overrides);
  (window as unknown as { bridge: Bridge }).bridge = full;
  return full;
}

beforeEach(() => {
  vi.resetModules();
});

describe("useSettingsStore", () => {
  it("starts from DEFAULT_SETTINGS and is unloaded", async () => {
    installBridge({});
    const { useSettingsStore } = await import("@/stores/settings");
    const { result } = renderHook(() => useSettingsStore());
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.current.loaded).toBe(false);
  });

  it("ensureLoaded pulls settings through window.bridge.getSettings once", async () => {
    const getSettings = vi.fn(async (): Promise<GetSettingsResponse> => ({
      settings: { ...DEFAULT_SETTINGS, theme: "paper" },
    }));
    installBridge({ getSettings });
    const { useSettingsStore } = await import("@/stores/settings");
    const { result } = renderHook(() => useSettingsStore());
    await act(async () => {
      await result.current.ensureLoaded();
    });
    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(result.current.settings.theme).toBe("paper");
    expect(result.current.loaded).toBe(true);
  });

  it("ensureLoaded is idempotent (subsequent calls do not hit the bridge)", async () => {
    const getSettings = vi.fn(async (): Promise<GetSettingsResponse> => ({
      settings: DEFAULT_SETTINGS,
    }));
    installBridge({ getSettings });
    const { useSettingsStore } = await import("@/stores/settings");
    const { result } = renderHook(() => useSettingsStore());
    await act(async () => {
      await result.current.ensureLoaded();
      await result.current.ensureLoaded();
    });
    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  it("update proxies through window.bridge.updateSettings and merges the response", async () => {
    const updateSettings = vi.fn(
      async (partial: Partial<Settings>): Promise<GetSettingsResponse> => ({
        settings: { ...DEFAULT_SETTINGS, ...partial },
      }),
    );
    installBridge({ updateSettings });
    const { useSettingsStore } = await import("@/stores/settings");
    const { result } = renderHook(() => useSettingsStore());
    await act(async () => {
      await result.current.update({ fontSize: 18 });
    });
    expect(updateSettings).toHaveBeenCalledWith({ fontSize: 18 });
    expect(result.current.settings.fontSize).toBe(18);
  });
});
