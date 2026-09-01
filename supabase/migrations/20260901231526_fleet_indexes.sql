-- Fleet scale: index last_seen for live counter (1000s users)
create index if not exists installs_last_seen_idx on public.installs (last_seen_at desc);
create index if not exists devices_last_seen_idx on public.devices (last_seen_at desc);