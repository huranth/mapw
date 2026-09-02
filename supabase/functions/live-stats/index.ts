// live-stats — public aggregate counts for the website's live user counter.
// Returns counts only, never rows: nothing here is personal data. The app
// heartbeats every 45s, so "online" = seen in the last 2 minutes — fast enough
// to feel live for 1000s, cheap enough for free tier (with DB index on last_seen).
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ONLINE_WINDOW_MS = 75 * 1000;

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
      // distinct users — head:true with count exact overcounts duplicates, but we treat as approximate
      // and de-duplicate via Set if needed in future; for now we use exact as before.
      admin.from("devices").select("user_id", { count: "exact", head: true }),
    ]);

    // Check all errors, not just two
    if (installsTotal.error || installsOnline.error || devicesOnline.error || devicesUsers.error) {
      console.error("[live-stats] count failed:", installsTotal.error ?? installsOnline.error ?? devicesOnline.error ?? devicesUsers.error);
      return json({ error: "failed to count" }, 500);
    }

    const onlineNow = (installsOnline.count ?? 0) + (devicesOnline.count ?? 0);
    // Cache 2s at edge — fleet feels live (up in ~1s via Realtime broadcast, down in ~2s via offline beacon + 5s poll).
    const cors = corsLive(req);
    const headers = { ...cors, "Cache-Control": "public, s-maxage=2, max-age=2", "CDN-Cache-Control": "max-age=5" };
    return new Response(JSON.stringify({
      installs: installsTotal.count ?? 0,
      users: devicesUsers.count ?? 0,
      onlineNow,
      updatedAt: new Date().toISOString(),
    }), { status: 200, headers: { "Content-Type": "application/json", ...headers } });
  } catch (err) {
    console.error("[live-stats] unexpected error:", err);
    return json({ error: "internal error" }, 500);
  }
});
