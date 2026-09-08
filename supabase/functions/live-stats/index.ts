// live-stats — public aggregate counts for the website's live user counter.
// Returns counts only, never rows: nothing here is personal data. The app
// heartbeats every 45s, so "online" = seen in the last 2 minutes — fast enough
// to feel live for 1000s, cheap enough for free tier (with DB index on last_seen).
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ONLINE_WINDOW_MS = 40 * 1000;

// In-memory cache — 1s per isolate to feel live for 0→1 and 1→0 transitions
let liveCache: { at: number; body: string; headers: Record<string, string> } | null = null;
const CACHE_MS = 1000;
// Per-IP rate limit for live-stats: 30 req/min per IP
const liveIpLimit = new Map<string, { count: number; windowStart: number }>();
const LIVE_IP_MAX = 30;
const LIVE_IP_WINDOW_MS = 60_000;

const ALLOWED_ORIGINS_LIVE = new Set([
  "https://mapw.vercel.app",
  "https://www.mapw.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
]);
function corsLive(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = !origin ? "*" : ALLOWED_ORIGINS_LIVE.has(origin) ? origin : "https://mapw.vercel.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey",
    "Vary": "Origin",
  };
}
function json(data: unknown, status = 200, req?: Request): Response {
  const cors = req ? corsLive(req) : { "Access-Control-Allow-Origin": "https://mapw.vercel.app", "Vary": "Origin" } as const;
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsLive(req) });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405, req);

  // IP rate limit for live-stats (prevent DB DoS)
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = (req.headers.get("cf-connecting-ip")?.trim()) || fwd.split(",").map((s) => s.trim()).filter(Boolean).pop() || "unknown";
  const nowIp = Date.now();
  const entry = liveIpLimit.get(ip);
  if (!entry || nowIp - entry.windowStart > LIVE_IP_WINDOW_MS) {
    liveIpLimit.set(ip, { count: 1, windowStart: nowIp });
  } else {
    if (entry.count >= LIVE_IP_MAX) {
      return json({ error: "rate limited" }, 429, req);
    }
    entry.count++;
  }
  if (liveIpLimit.size > 2000) {
    for (const [k, v] of liveIpLimit) if (nowIp - v.windowStart > LIVE_IP_WINDOW_MS) liveIpLimit.delete(k);
  }

  // Serve from in-memory cache if fresh
  const nowCache = Date.now();
  if (liveCache && nowCache - liveCache.at < CACHE_MS) {
    return new Response(liveCache.body, { status: 200, headers: { "Content-Type": "application/json", ...liveCache.headers } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "misconfigured" }, 500);
  }
  const admin = createClient(supabaseUrl, serviceKey);

  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();

  try {
    const [installsTotal, installsOnline, devicesOnline, devicesUsers] = await Promise.all([
      admin.from("installs").select("id", { count: "exact", head: true }),
      admin.from("installs").select("id", { count: "exact", head: true })
        .gt("last_seen_at", cutoff),
      admin.from("devices").select("id", { count: "exact", head: true })
        .gt("last_seen_at", cutoff),
      admin.from("devices").select("user_id", { count: "exact", head: true }),
    ]);

    if (installsTotal.error || installsOnline.error || devicesOnline.error || devicesUsers.error) {
      console.error("[live-stats] count failed:", installsTotal.error ?? installsOnline.error ?? devicesOnline.error ?? devicesUsers.error);
      return json({ error: "failed to count" }, 500);
    }

    const onlineNow = (installsOnline.count ?? 0) + (devicesOnline.count ?? 0);
    const cors = corsLive(req);
    const headers = { ...cors, "Cache-Control": "public, s-maxage=1, max-age=1", "CDN-Cache-Control": "max-age=2" };
    const body = JSON.stringify({
      installs: installsTotal.count ?? 0,
      users: devicesUsers.count ?? 0,
      onlineNow,
      updatedAt: new Date().toISOString(),
    });
    liveCache = { at: Date.now(), body, headers };
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json", ...headers } });
  } catch (err) {
    console.error("[live-stats] unexpected error:", err);
    return json({ error: "internal error" }, 500);
  }
});
