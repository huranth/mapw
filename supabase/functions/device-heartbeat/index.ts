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

function clip(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
}

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const candidate = forwarded.split(",")[0]!.trim();
  return candidate !== "" && (IPV4_RE.test(candidate) || IPV6_RE.test(candidate))
    ? candidate
    : null;
}

interface HeartbeatBody {
  installId?: unknown;
  label?: unknown;
  platform?: unknown;
  appVersion?: unknown;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const body = (await req.json().catch(() => ({}))) as HeartbeatBody;
  const label = clip(body.label, 120) ?? "unknown-device";
  const platform = clip(body.platform, 40) ?? "unknown";
  const appVersion = clip(body.appVersion, 40);
  const now = new Date().toISOString();

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
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
    if (error) return Response.json({ error: "internal error" }, { status: 500 });
    return Response.json({ ok: true, kind: "device" });
  }

  // Anonymous install path.
  if (typeof body.installId !== "string" || !UUID_RE.test(body.installId)) {
    return Response.json({ error: "installId must be a uuid" }, { status: 400 });
  }
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
  if (error) return Response.json({ error: "internal error" }, { status: 500 });
  return Response.json({ ok: true, kind: "install" });
});
