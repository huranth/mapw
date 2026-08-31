-- installs + releases bucket — 2026-08-29
-- The desktop app ships without accounts: every machine gets a client-generated
-- installId (uuid) and heartbeats it on launch + every 15 min. `installs` is the
-- anonymous twin of `devices` (which future auth'd users populate). The live
-- counter on the website aggregates both. RLS is on with NO policies — only the
-- service role (edge functions) touches this table.

create table public.installs (
  id           uuid primary key,
  label        text not null default 'unknown-device',
  platform     text not null default 'unknown',
  app_version  text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_ip      inet
);

alter table public.installs enable row level security;

-- Public bucket holding app releases: latest.json + mapw-<version>.exe.
-- The app's updater and the website's download button both read it; publishing
-- goes through scripts/publish-release.mjs with the service role key.
insert into storage.buckets (id, name, public)
values ('releases', 'releases', true)
on conflict (id) do nothing;
