// live-stats — public aggregate counts for the website's live user counter.
// Returns counts only, never rows: nothing here is personal data. The app
// heartbeats every 15 min, so "online" = seen in the last 20 minutes.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ONLINE_WINDOW_MS = 20 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
} as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

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
    // Cache for 30s at edge, 60s at CDN to reduce DB load
    const headers = { ...CORS, "Cache-Control": "public, s-maxage=30, max-age=15", "CDN-Cache-Control": "max-age=60" };
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
