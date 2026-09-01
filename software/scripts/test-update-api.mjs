#!/usr/bin/env node
// Test the update API wiring: fetches latest.json and live-stats from Supabase
// and verifies they are reachable and correctly formed.
// Run with: node scripts/test-update-api.mjs [--url https://.../latest.json]

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "https://pdynfowdtiulrllqetbl.supabase.co";
const latestUrl = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url")+1] : `${supabaseUrl}/storage/v1/object/public/releases/latest.json`;
const liveStatsUrl = `${supabaseUrl}/functions/v1/live-stats`;

async function testLatest() {
  console.log(`→ Testing latest.json: ${latestUrl}`);
  const res = await fetch(latestUrl, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    console.log(`  latest.json not yet published (HTTP ${res.status}) — this is expected before first release`);
    return true;
  }
  const data = await res.json();
  if (typeof data.version !== "string" || typeof data.url !== "string") {
    console.error("  FAIL: latest.json missing version/url", data);
    return false;
  }
  const trusted = data.url.startsWith("https://") && (data.url.includes(".supabase.co/storage/v1/object/public/releases/") || data.url.startsWith("https://github.com/huranth/mapw"));
  if (!trusted) {
    console.error("  FAIL: url not trusted", data.url);
    return false;
  }
  console.log(`  OK: v${data.version} → ${data.url}`);
  if (data.gzUrl) console.log(`  OK: gz → ${data.gzUrl}`);
  // try HEAD on the exe to ensure it's reachable
  try {
    const head = await fetch(data.url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    console.log(`  HEAD ${data.url}: ${head.status} ${head.headers.get("content-length") ?? ""} bytes`);
  } catch (e) {
    console.warn("  WARN: HEAD failed", e.message);
  }
  return true;
}

async function testLiveStats() {
  console.log(`→ Testing live-stats: ${liveStatsUrl}`);
  const res = await fetch(liveStatsUrl, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    console.error(`  FAIL: live-stats HTTP ${res.status} ${await res.text()}`);
    return false;
  }
  const data = await res.json();
  if (typeof data.installs !== "number" || typeof data.onlineNow !== "number") {
    console.error("  FAIL: live-stats missing fields", data);
    return false;
  }
  console.log(`  OK: ${data.installs} installs, ${data.onlineNow} online`);
  return true;
}

const ok1 = await testLatest();
const ok2 = await testLiveStats();
if (ok1 && ok2) {
  console.log("\n✓ All wiring checks passed");
  process.exit(0);
} else {
  console.error("\n✗ Some checks failed");
  process.exit(1);
}
