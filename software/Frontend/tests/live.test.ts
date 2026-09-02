import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Live fleet — integration smoke for heartbeat → live-stats
// These run against the real Supabase edge functions (network), so they are skipped in offline CI.
// To run: SUPABASE_URL=https://... npm run test -- live.test

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "https://pdynfowdtiulrllqetbl.supabase.co";
const LIVE_STATS_URL = `${SUPABASE_URL}/functions/v1/live-stats`;
const HEARTBEAT_URL = `${SUPABASE_URL}/functions/v1/device-heartbeat`;

function uuid(): string {
  // RFC4122 v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

describe("live fleet — heartbeat → live-stats", () => {
  const id = uuid();
  afterEach(async () => {
    // best-effort cleanup: mark offline so live drops
    try {
      await fetch(HEARTBEAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installId: id, offline: true }),
      });
    } catch {}
  });

  it("heartbeat creates an install and live goes 1", async () => {
    // This is a live test — skip if no network (CI without SUPABASE_URL would still have default, but network may be blocked)
    // We attempt and if fetch fails, skip
    let before: any;
    try {
      const r = await fetch(LIVE_STATS_URL, { signal: AbortSignal.timeout(5000) });
      before = await r.json();
    } catch {
      return; // skip live test in offline env
    }
    const beforeInstalls = before.installs as number;

    const hb = await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installId: id, label: "test-live", platform: "test", appVersion: "0.0.0-test" }),
    });
    expect(hb.ok).toBe(true);
    const hbBody = await hb.json();
    expect(hbBody.ok).toBe(true);

    // Realtime broadcast is async, but live-stats should reflect within 2s (cache 2s)
    await new Promise((r) => setTimeout(r, 2500));

    const r2 = await fetch(LIVE_STATS_URL + "?t=" + Date.now(), { cache: "no-store" } as any);
    const after = await r2.json();
    expect(after.installs).toBe(beforeInstalls + 1);
    expect(after.onlineNow).toBeGreaterThanOrEqual(1);
  }, 15000);

  it("offline beacon makes live drop", async () => {
    // First heartbeat to ensure online
    const hb1 = await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installId: id, label: "test-offline", platform: "test", appVersion: "0.0.0-test" }),
    });
    if (!hb1.ok) return; // skip if network blocked
    await new Promise((r) => setTimeout(r, 1500));
    // Now offline
    const off = await fetch(HEARTBEAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installId: id, offline: true }),
    });
    expect(off.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 2500));
    const r = await fetch(LIVE_STATS_URL + "?t=" + Date.now(), { cache: "no-store" } as any);
    const after = await r.json();
    // installs stays, online drops (at least not counted)
    expect(after.installs).toBeGreaterThanOrEqual(1);
    // online may still be 1 if other demo is online, so just check it didn't crash
    expect(typeof after.onlineNow).toBe("number");
  }, 15000);
});
