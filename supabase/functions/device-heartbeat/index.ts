// device-heartbeat — called by the mapw desktop app on launch and every 15 min.
// Two paths:
//  • Signed-in users (Authorization: Bearer <supabase jwt>) → upsert into
//    `devices`, keyed by (user_id, label). last_ip comes from x-forwarded-for,
//    captured server-side — never trusted from the request body.
//  • Anonymous installs (no auth) → upsert into `installs`, keyed by the
//    client-generated installId uuid. This is what powers the live counter
//    before accounts exist.
// Both paths are service-role writes; RLS has no client policies by design.
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/;

// Simple in-memory rate limit: installId -> last timestamp (ms)
const rateLimit = new Map<string, number>();
const RATE_LIMIT_MS = 5_000;

function clip(v: unknown, max: number): string | null {
  // also strip control chars and trim to prevent header injection
  if (typeof v !== "string" || v.length === 0) return null;
  const cleaned = v.replace(/[\x00-\x1F\x7F]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, max) : null;
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const candidate = forwarded.split(",")[0]!.trim();
  // Validate IP and ensure it's not private spoofed beyond trust
  if (candidate === "") return null;
  if (IPV4_RE.test(candidate)) {
    // basic octet range check
    const parts = candidate.split(".").map(Number);
    if (parts.some((n) => n < 0 || n > 255)) return null;
    return candidate;
  }
  if (IPV6_RE.test(candidate)) return candidate;
  return null;
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const last = rateLimit.get(key);
  if (last != null && now - last < RATE_LIMIT_MS) return true;
  rateLimit.set(key, now);
  // prune old entries to prevent memory leak
  if (rateLimit.size > 1000) {
    for (const [k, t] of rateLimit) if (now - t > 60_000) rateLimit.delete(k);
  }
  return false;
}

interface HeartbeatBody {
  installId?: unknown;
  label?: unknown;
  platform?: unknown;
  appVersion?: unknown;
  offline?: unknown;
}

const ALLOWED_ORIGINS = new Set([
  "https://mapw.vercel.app",
  "https://www.mapw.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
]);
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  // Electron has no Origin — allow it (no browser to enforce CORS anyway)
  const allow = !origin ? "*" : ALLOWED_ORIGINS.has(origin) ? origin : "https://mapw.vercel.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const CORS_HEADERS = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405, headers: CORS_HEADERS });
  }

  let body: HeartbeatBody;
  try {
    body = (await req.json()) as HeartbeatBody;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400, headers: CORS_HEADERS });
  }

  const label = clip(body.label, 120) ?? "unknown-device";
  const platform = clip(body.platform, 40) ?? "unknown";
  const appVersion = clip(body.appVersion, 40);
  const now = new Date().toISOString();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ error: "misconfigured" }, { status: 500, headers: CORS_HEADERS });
  }
  const admin = createClient(supabaseUrl, serviceKey);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS_HEADERS });
    // Rate limit on token prefix to prevent brute force
    if (isRateLimited(`auth:${token.slice(0, 8)}`)) {
      return Response.json({ error: "rate limited" }, { status: 429, headers: CORS_HEADERS });
    }
    try {
      const { data: userData, error: userError } = await admin.auth.getUser(token);
      if (userError || !userData.user) {
        return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS_HEADERS });
      }
      const { error } = await admin.from("devices").upsert(
        {
          user_id: userData.user.id,
          label,
          platform,
          app_version: appVersion,
          last_seen_at: now,
          last_ip: clientIp(req),
        },
        { onConflict: "user_id,label" },
      );
      if (error) {
        console.error("[device-heartbeat] devices upsert failed:", error);
        return Response.json({ error: "internal error" }, { status: 500, headers: CORS_HEADERS });
      }
      // Best-effort realtime push — makes fleet live in ~1s for 1000s without polling storm
      try { const ch = admin.channel("fleet:live"); await ch.send({ type: "broadcast", event: "fleet_update", payload: { ts: now } }); } catch {}
      return Response.json({ ok: true, kind: "device" }, { headers: CORS_HEADERS });
    } catch (err) {
      console.error("[device-heartbeat] auth path error:", err);
      return Response.json({ error: "internal error" }, { status: 500, headers: CORS_HEADERS });
    }
  }

  // Anonymous install path.
  if (typeof body.installId !== "string" || !UUID_RE.test(body.installId)) {
    return Response.json({ error: "installId must be a uuid" }, { status: 400, headers: CORS_HEADERS });
  }
  if (isRateLimited(`anon:${body.installId}`)) {
    return Response.json({ error: "rate limited" }, { status: 429, headers: CORS_HEADERS });
  }
  // Offline beacon — mark as not online without deleting the row (preserves installs count)
  if (body.offline === true) {
    try {
      const { error } = await admin.from("installs").update({
        last_seen_at: new Date(0).toISOString(), // 1970 — falls out of 20m window
        last_ip: clientIp(req),
      }).eq("id", body.installId);
      if (error) {
        console.error("[device-heartbeat] offline update failed:", error);
        return Response.json({ error: "internal error" }, { status: 500, headers: CORS_HEADERS });
      }
      try { const ch = admin.channel("fleet:live"); await ch.send({ type: "broadcast", event: "fleet_update", payload: { ts: now } }); } catch {}
      return Response.json({ ok: true, kind: "install", offline: true }, { headers: CORS_HEADERS });
    } catch (err) {
      console.error("[device-heartbeat] offline path error:", err);
      return Response.json({ error: "internal error" }, { status: 500, headers: CORS_HEADERS });
    }
  }
  try {
    const { error } = await admin.from("installs").upsert(
      {
        id: body.installId,
        label,
        platform,
        app_version: appVersion,
        last_seen_at: now,
        last_ip: clientIp(req),
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error("[device-heartbeat] installs upsert failed:", error);
      return Response.json({ error: "internal error" }, { status: 500, headers: CORS_HEADERS });
    }
    try { const ch = admin.channel("fleet:live"); await ch.send({ type: "broadcast", event: "fleet_update", payload: { ts: now } }); } catch {}
    return Response.json({ ok: true, kind: "install" }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[device-heartbeat] anon path error:", err);
    return Response.json({ error: "internal error" }, { status: 500, headers: CORS_HEADERS });
  }
});
