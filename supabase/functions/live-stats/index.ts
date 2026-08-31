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

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();

  const [installsTotal, installsOnline, devicesOnline, devicesUsers] = await Promise.all([
    admin.from("installs").select("id", { count: "exact", head: true }),
    admin.from("installs").select("id", { count: "exact", head: true })
      .gt("last_seen_at", cutoff),
    admin.from("devices").select("id", { count: "exact", head: true })
      .gt("last_seen_at", cutoff),
    admin.from("devices").select("user_id", { count: "exact", head: true }),
  ]);

  if (installsTotal.error || devicesUsers.error) {
    return json({ error: "failed to count" }, 500);
  }

  return json({
    installs: installsTotal.count ?? 0,
    users: devicesUsers.count ?? 0,
    onlineNow: (installsOnline.count ?? 0) + (devicesOnline.count ?? 0),
    updatedAt: new Date().toISOString(),
  });
});
